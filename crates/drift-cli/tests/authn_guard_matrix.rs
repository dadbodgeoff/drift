//! A sign-in guard whose only 401 is sent from the `catch` of what it verifies, as a
//! matrix: where the guard is attached, where it is defined, how the verification is
//! written in the `try`, how the `catch` is written and how the 401 is sent, in
//! Fastify, Express, Hono, NestJS and Next.js. Every cell is generated here and read
//! by the built binary.
//!
//! The rule: a function that answers 401 in the handler of a `try` every request
//! enters, and reaches its continuation only past that `try`, is a sign-in guard. A
//! handler that swallows, a 401 under a further condition, a `try` under a branch
//! and a handler that hands the request on are not: unknown where a 401 was found,
//! never known. `drift security` says of every route what the practice map says.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// The files of a fixture repository, by path.
type Files = BTreeMap<String, String>;

fn write(files: &Files) -> tempfile::TempDir {
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

/// A route with its method, as both readings are keyed: `GET /items`.
fn unit_key(u: &Value) -> String {
    format!(
        "{} {}",
        u["method"].as_str().unwrap_or_default(),
        u["route"].as_str().unwrap_or_default()
    )
}

/// What the practice map says of authentication, by route: the assignment, and the
/// key the unit is known by or the reason it is unknown.
fn authn(root: &Path) -> BTreeMap<String, (String, String)> {
    let v = drift(root, &["practices", "--json", "--units"]);
    let c = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .expect("no authn concern");
    let variants: Vec<&Value> = c["variants"].as_array().into_iter().flatten().collect();
    c["units"]
        .as_array()
        .unwrap_or_else(|| panic!("no units: {c:#}"))
        .iter()
        .map(|u| {
            let assignment = u["assignment"].as_str().unwrap();
            let what = match assignment {
                // A unit's own key, else the key of the variant it is in.
                "known" | "identified" => u["key"].as_str().or_else(|| {
                    variants
                        .iter()
                        .copied()
                        .chain(
                            variants
                                .iter()
                                .filter_map(|v| v["alternatives"].as_array())
                                .flatten(),
                        )
                        .find(|v| v["id"] == u["variant"])
                        .and_then(|v| v["key"].as_str())
                }),
                "unknown" => u["reason"].as_str(),
                _ => None,
            };
            (
                unit_key(u),
                (assignment.to_string(), what.unwrap_or_default().to_string()),
            )
        })
        .collect()
}

/// What `drift security` lists, by route: the guards, and what may guard the route
/// and could not be read.
fn inventory(root: &Path) -> BTreeMap<String, (Vec<String>, Vec<String>)> {
    let list = |v: &Value| -> Vec<String> {
        v.as_array()
            .into_iter()
            .flatten()
            .map(|x| x.as_str().unwrap().to_string())
            .collect()
    };
    drift(root, &["security", "--json"])["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (unit_key(e), (list(&e["guards"]), list(&e["opaque"]))))
        .collect()
}

/// Both readings of a fixture, held to one another: a route the practice map knows
/// has a guard in the inventory, one it does not know is "guard unknown" there, and
/// one with nothing has no guard and nothing unread.
struct Read {
    authn: BTreeMap<String, (String, String)>,
    inventory: BTreeMap<String, (Vec<String>, Vec<String>)>,
}

fn read(root: &Path, what: &str) -> Read {
    let r = Read {
        authn: authn(root),
        inventory: inventory(root),
    };
    assert_eq!(
        r.authn.keys().collect::<Vec<_>>(),
        r.inventory.keys().collect::<Vec<_>>(),
        "{what}: the two list the same routes"
    );
    for (route, (assignment, key)) in &r.authn {
        let (guards, opaque) = &r.inventory[route];
        let state = match (guards.is_empty(), opaque.is_empty()) {
            (false, _) => "known",
            (true, false) => "unknown",
            (true, true) => "none",
        };
        // Known by what turns no one away (a session read with no check on it, a
        // public marker) is no guard.
        let enforced = key.split('+').any(|piece| {
            !["identifies:", "opens:", "service_auth:"]
                .iter()
                .any(|m| piece.starts_with(m))
        });
        let assignment = match assignment.as_str() {
            "known" if !enforced => "none",
            // The caller identified and no one turned away: no guard there either.
            "identified" => "none",
            a => a,
        };
        assert_eq!(
            state, assignment,
            "{what} {route}: the inventory says {guards:?} / unread {opaque:?}, the practice map {assignment} {key}"
        );
    }
    r
}

impl Read {
    /// The route is known by `key`, and the inventory names `guard` as its guard.
    fn guarded(&self, what: &str, route: &str, key: &str, guard: &str) {
        let route = &format!("GET {route}");
        let said = self
            .authn
            .get(route)
            .unwrap_or_else(|| panic!("{what}: no unit at {route}: {:?}", self.authn.keys()));
        assert_eq!(
            (said.0.as_str(), said.1.as_str()),
            ("known", key),
            "{what} {route}"
        );
        assert!(
            self.inventory[route].0.iter().any(|g| g == guard),
            "{what} {route}: the inventory's guards {:?} do not name {guard}",
            self.inventory[route].0
        );
    }

    /// What the map says of the `GET` route.
    fn assignment(&self, what: &str, route: &str) -> &str {
        self.authn
            .get(&format!("GET {route}"))
            .unwrap_or_else(|| panic!("{what}: no unit at {route}: {:?}", self.authn.keys()))
            .0
            .as_str()
    }
}

/// How a `catch` is written.
const CATCH: &[(&str, &str)] = &[
    ("nobinding", "catch {"),
    ("e", "catch (e) {"),
    ("unknown", "catch (err: unknown) {"),
];

/// One guard of a matrix: its name, the route it guards, and its function body.
struct Guard {
    name: String,
    route: String,
    body: String,
}

/// Where the guards of a fixture are defined.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Define {
    /// In the file that registers the routes.
    Same,
    /// `import { g } from "./auth"`.
    Imported,
    /// `export default async function g`, one file each.
    Default,
    /// A method of an object: `guards.g`, written as a method and as an arrow.
    Method,
}

const DEFINE: &[Define] = &[
    Define::Same,
    Define::Imported,
    Define::Default,
    Define::Method,
];

/// The guards as source: what goes in the routes' file (imports, then definitions),
/// the other files, and for each guard the expression that names it, the file and
/// the name it is defined under.
struct Defined {
    imports: String,
    inline: String,
    files: Files,
    refs: Vec<(String, String, String)>,
}

fn define(how: Define, guards: &[Guard], signature: &str, head: &str) -> Defined {
    let mut d = Defined {
        imports: String::new(),
        inline: String::new(),
        files: Files::new(),
        refs: Vec::new(),
    };
    let function = |g: &Guard, export: &str| {
        format!(
            "{export}async function {}{signature} {{\n{}}}\n",
            g.name, g.body
        )
    };
    match how {
        Define::Same => {
            d.imports = head.to_string();
            for g in guards {
                d.inline += &function(g, "");
                d.refs
                    .push((g.name.clone(), "src/server.ts".into(), g.name.clone()));
            }
        }
        Define::Imported => {
            let mut auth = head.to_string();
            for g in guards {
                auth += &function(g, "export ");
                d.imports += &format!("import {{ {} }} from \"./auth\";\n", g.name);
                d.refs
                    .push((g.name.clone(), "src/auth.ts".into(), g.name.clone()));
            }
            d.files.insert("src/auth.ts".into(), auth);
        }
        Define::Default => {
            for g in guards {
                let file = format!("src/guards/{}.ts", g.name);
                d.files.insert(
                    file.clone(),
                    format!(
                        "{}{}",
                        head.replace("\"./", "\"../"),
                        function(g, "export default ")
                    ),
                );
                d.imports += &format!("import {} from \"./guards/{}\";\n", g.name, g.name);
                d.refs.push((g.name.clone(), file, g.name.clone()));
            }
        }
        Define::Method => {
            let mut auth = format!("{head}export const guards = {{\n");
            for (i, g) in guards.iter().enumerate() {
                auth += &if i % 2 == 0 {
                    format!("  async {}{signature} {{\n{}  }},\n", g.name, g.body)
                } else {
                    format!("  {}: async {signature} => {{\n{}  }},\n", g.name, g.body)
                };
                d.refs.push((
                    format!("guards.{}", g.name),
                    "src/auth.ts".into(),
                    format!("guards.{}", g.name),
                ));
            }
            auth += "};\n";
            d.files.insert("src/auth.ts".into(), auth);
            d.imports = "import { guards } from \"./auth\";\n".to_string();
        }
    }
    d
}

/// `verifyToken`, in the repository.
const TOKENS: &str = r#"import jwt from "jsonwebtoken";
export async function verifyToken(token: string) {
  return jwt.verify(token, process.env.JWT_SECRET!) as { id: string; fleetId: string };
}
"#;

// ---- Fastify ----------------------------------------------------------------------

const FASTIFY_VERIFY: &[(&str, &str)] = &[
    ("bare", "await request.jwtVerify();"),
    (
        "assigned",
        "request.operator = await request.jwtVerify<Operator>();",
    ),
    (
        "copied",
        "const payload = await request.jwtVerify<Operator>();\n    request.operator = payload;",
    ),
    (
        "jwt",
        "request.operator = jwt.verify(String(request.headers.authorization), process.env.JWT_SECRET!) as Operator;",
    ),
    (
        "inrepo",
        "request.operator = await verifyToken(String(request.headers.authorization));",
    ),
];

const FASTIFY_SEND: &[(&str, &str)] = &[
    (
        "return",
        "return reply.code(401).send({ error: \"unauthenticated\" });",
    ),
    (
        "status",
        "reply.status(401).send({ error: \"unauthenticated\" });",
    ),
    ("throw", "throw request.server.httpErrors.unauthorized();"),
    ("throw-app", "throw app.httpErrors.unauthorized();"),
    ("sensible", "reply.unauthorized();"),
];

/// How a Fastify guard is attached to its route: the statements, given the
/// expression that names the guard, the route and a number; and the mechanism the
/// practice map reads it by.
const FASTIFY_ATTACH: &[(&str, &str, &str)] = &[
    (
        "single",
        "app.get(\"@R@\", { onRequest: @G@ }, async () => []);\n",
        "wrap",
    ),
    (
        "prehandler",
        "app.get(\"@R@\", { preHandler: @G@ }, async () => []);\n",
        "wrap",
    ),
    (
        "prevalidation",
        "app.get(\"@R@\", { preValidation: @G@ }, async () => []);\n",
        "wrap",
    ),
    (
        "array",
        "app.get(\"@R@\", { onRequest: [@G@] }, async () => []);\n",
        "wrap",
    ),
    (
        "hook",
        "const app@N@ = Fastify();\napp@N@.addHook(\"onRequest\", @G@);\napp@N@.get(\"@R@\", async () => []);\n",
        "middleware",
    ),
    (
        "options",
        "const secured@N@ = { onRequest: @G@ };\napp.get(\"@R@\", secured@N@, async () => []);\n",
        "wrap",
    ),
    (
        "spread",
        "const secured@N@ = { onRequest: [@G@] };\napp.get(\"@R@\", { ...secured@N@ }, async () => []);\n",
        "middleware",
    ),
];

fn fastify_guards() -> Vec<Guard> {
    let mut out = Vec::new();
    for (v, verify) in FASTIFY_VERIFY {
        for (c, catch) in CATCH {
            for (s, send) in FASTIFY_SEND {
                out.push(Guard {
                    name: format!("g{}", out.len()),
                    route: format!("/{v}/{c}/{s}"),
                    body: format!("  try {{\n    {verify}\n  }} {catch}\n    {send}\n  }}\n"),
                });
            }
        }
    }
    out
}

const FASTIFY_PACKAGE: &str = r#"{ "name": "api", "dependencies": { "fastify": "5.0.0", "@fastify/jwt": "9.0.0", "@fastify/sensible": "6.0.0", "jsonwebtoken": "9.0.0" } }
"#;

/// A Fastify server with these guards, defined and attached so.
fn fastify(guards: &[Guard], how: Define, attach: &str) -> Files {
    let head = format!(
        "import type {{ FastifyInstance, FastifyReply, FastifyRequest }} from \"fastify\";\nimport jwt from \"jsonwebtoken\";\nimport {{ verifyToken }} from \"./tokens\";\ntype Operator = {{ id: string; fleetId: string }};\n{}",
        if how == Define::Same {
            ""
        } else {
            "declare const app: FastifyInstance;\n"
        }
    );
    let d = define(
        how,
        guards,
        "(request: FastifyRequest, reply: FastifyReply)",
        &head,
    );
    let mut server = format!(
        "import Fastify from \"fastify\";\n{}const app = Fastify();\n{}",
        d.imports, d.inline
    );
    for (i, (g, (name, _, _))) in guards.iter().zip(&d.refs).enumerate() {
        server += &attach
            .replace("@G@", name)
            .replace("@R@", &g.route)
            .replace("@N@", &i.to_string());
    }
    server += "app.get(\"/open\", async () => []);\napp.listen({ port: 3000 });\n";
    let mut files = d.files;
    files.insert("package.json".into(), FASTIFY_PACKAGE.into());
    files.insert("src/tokens.ts".into(), TOKENS.into());
    files.insert("src/server.ts".into(), server);
    files
}

/// [STRICT] Fastify: 7 ways to attach x 4 ways to define x 5 verifications x 3
/// catches x 5 ways to send the 401. The cell the unseen cases failed on is `single`
/// / `Imported` / `assigned`: `{ onRequest: authenticate }` with
/// `request.operator = await request.jwtVerify<Operator>()` in the `try`, which read
/// `none` because only a call that was a statement of its own was a verification.
#[test]
fn fastify_a_401_from_the_catch_is_the_guard_in_every_cell() {
    let guards = fastify_guards();
    assert_eq!(guards.len(), 75);
    for (attach, statements, mechanism) in FASTIFY_ATTACH {
        for how in DEFINE {
            let what = format!("fastify {attach} {how:?}");
            let files = fastify(&guards, *how, statements);
            let dir = write(&files);
            let r = read(dir.path(), &what);
            let d = define(*how, &guards, "", "");
            for (i, (g, (_, file, name))) in guards.iter().zip(&d.refs).enumerate() {
                // The inventory names what is written on the route: the options.
                let listed = match *attach {
                    "options" => format!("secured{i}"),
                    _ if *mechanism == "middleware" => format!("{name} (middleware)"),
                    _ => name.clone(),
                };
                r.guarded(
                    &what,
                    &g.route,
                    &format!("{mechanism}:{file}#{name}"),
                    &listed,
                );
            }
            assert_eq!(r.assignment(&what, "/open"), "none", "{what}");
        }
    }
}

// ---- Express ----------------------------------------------------------------------

const EXPRESS_VERIFY: &[(&str, &str)] = &[
    (
        "bare",
        "jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);",
    ),
    (
        "assigned",
        "req.user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!) as Operator;",
    ),
    (
        "copied",
        "const payload = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);\n    req.user = payload;",
    ),
    (
        "inrepo",
        "req.user = await verifyToken(String(req.headers.authorization));",
    ),
];

const EXPRESS_SEND: &[(&str, &str)] = &[
    (
        "json",
        "return res.status(401).json({ error: \"unauthenticated\" });",
    ),
    ("sendstatus", "return res.sendStatus(401);"),
    ("next-error", "return next(createError(401));"),
    (
        "then-return",
        "res.status(401).json({ error: \"unauthenticated\" });\n    return;",
    ),
];

/// Where the guard hands the request on: after the `try`, or as the last statement
/// in it.
const EXPRESS_NEXT: &[(&str, &str)] = &[
    (
        "after",
        "  try {\n    @V@\n  } @C@\n    @S@\n  }\n  next();\n",
    ),
    (
        "inside",
        "  try {\n    @V@\n    next();\n  } @C@\n    @S@\n  }\n",
    ),
];

const EXPRESS_ATTACH: &[(&str, &str, &str, &str)] = &[
    (
        "argument",
        "app.get(\"@R@\", @G@, (req, res) => {\n  res.json([]);\n});\n",
        "wrap",
        "",
    ),
    (
        "array",
        "app.get(\"@R@\", [@G@], (req, res) => {\n  res.json([]);\n});\n",
        "wrap",
        "",
    ),
    (
        "router",
        "const r@N@ = express.Router();\nr@N@.use(@G@);\nr@N@.get(\"/items\", (req, res) => {\n  res.json([]);\n});\napp.use(\"@R@\", r@N@);\n",
        "wrap",
        "/items",
    ),
    (
        "path",
        "app.use(\"@R@\", @G@);\napp.get(\"@R@/items\", (req, res) => {\n  res.json([]);\n});\n",
        "middleware",
        "/items",
    ),
];

fn express_guards() -> Vec<Guard> {
    let mut out = Vec::new();
    for (v, verify) in EXPRESS_VERIFY {
        for (c, catch) in CATCH {
            for (s, send) in EXPRESS_SEND {
                for (n, shape) in EXPRESS_NEXT {
                    out.push(Guard {
                        name: format!("g{}", out.len()),
                        route: format!("/{v}/{c}/{s}/{n}"),
                        body: shape
                            .replace("@V@", verify)
                            .replace("@C@", catch)
                            .replace("@S@", send),
                    });
                }
            }
        }
    }
    out
}

const EXPRESS_PACKAGE: &str = r#"{ "name": "api", "dependencies": { "express": "4.19.0", "jsonwebtoken": "9.0.0", "http-errors": "2.0.0" } }
"#;

const EXPRESS_HEAD: &str = "import type { NextFunction, Request, Response } from \"express\";\nimport jwt from \"jsonwebtoken\";\nimport createError from \"http-errors\";\nimport { verifyToken } from \"./tokens\";\ntype Operator = { id: string; fleetId: string };\n";

fn express(guards: &[Guard], how: Define, attach: &str) -> Files {
    let d = define(
        how,
        guards,
        "(req: Request, res: Response, next: NextFunction)",
        EXPRESS_HEAD,
    );
    let mut server = format!(
        "import express from \"express\";\n{}const app = express();\n{}",
        d.imports, d.inline
    );
    for (i, (g, (name, _, _))) in guards.iter().zip(&d.refs).enumerate() {
        server += &attach
            .replace("@G@", name)
            .replace("@R@", &g.route)
            .replace("@N@", &i.to_string());
    }
    server += "app.get(\"/open\", (req, res) => {\n  res.json([]);\n});\napp.listen(3000);\n";
    let mut files = d.files;
    files.insert("package.json".into(), EXPRESS_PACKAGE.into());
    files.insert("src/tokens.ts".into(), TOKENS.into());
    files.insert("src/server.ts".into(), server);
    files
}

/// [STRICT] Express: 4 ways to attach x 4 ways to define x 4 verifications x 3
/// catches x 4 ways to send the 401 (`return res.status(401).json(...)`,
/// `res.sendStatus(401)`, `next(createError(401))`, the answer then a bare `return`)
/// x `next()` after the `try` or as its last statement.
#[test]
fn express_a_401_from_the_catch_is_the_guard_in_every_cell() {
    let guards = express_guards();
    assert_eq!(guards.len(), 96);
    for (attach, statements, mechanism, under) in EXPRESS_ATTACH {
        for how in DEFINE {
            let what = format!("express {attach} {how:?}");
            let dir = write(&express(&guards, *how, statements));
            let r = read(dir.path(), &what);
            let d = define(*how, &guards, "", "");
            for (g, (_, file, name)) in guards.iter().zip(&d.refs) {
                let suffix = if *mechanism == "middleware" {
                    " (middleware)"
                } else {
                    ""
                };
                r.guarded(
                    &what,
                    &format!("{}{under}", g.route),
                    &format!("{mechanism}:{file}#{name}"),
                    &format!("{name}{suffix}"),
                );
            }
            assert_eq!(r.assignment(&what, "/open"), "none", "{what}");
        }
    }
}

// ---- Hono -------------------------------------------------------------------------

const HONO_VERIFY: &[(&str, &str)] = &[
    (
        "set",
        "c.set(\"user\", await verify(c.req.header(\"authorization\") ?? \"\", process.env.JWT_SECRET!));",
    ),
    (
        "copied",
        "const payload = await verify(c.req.header(\"authorization\") ?? \"\", process.env.JWT_SECRET!);\n    c.set(\"user\", payload);",
    ),
    (
        "inrepo",
        "c.set(\"user\", await verifyToken(c.req.header(\"authorization\") ?? \"\"));",
    ),
];

const HONO_SEND: &[(&str, &str)] = &[
    ("throw", "throw new HTTPException(401);"),
    (
        "json",
        "return c.json({ error: \"unauthenticated\" }, 401);",
    ),
];

const HONO_ATTACH: &[(&str, &str, &str, &str)] = &[
    (
        "argument",
        "app.get(\"@R@\", @G@, (c) => c.json([]));\n",
        "wrap",
        "",
    ),
    (
        "path",
        "app.use(\"@R@/*\", @G@);\napp.get(\"@R@/items\", (c) => c.json([]));\n",
        "middleware",
        "/items",
    ),
];

fn hono_guards() -> Vec<Guard> {
    let mut out = Vec::new();
    for (v, verify) in HONO_VERIFY {
        for (c, catch) in CATCH {
            for (s, send) in HONO_SEND {
                out.push(Guard {
                    name: format!("g{}", out.len()),
                    route: format!("/{v}/{c}/{s}"),
                    body: format!(
                        "  try {{\n    {verify}\n  }} {catch}\n    {send}\n  }}\n  await next();\n"
                    ),
                });
            }
        }
    }
    out
}

/// [STRICT] Hono: `throw new HTTPException(401)` and `return c.json(..., 401)` from
/// the `catch`, as a handler of the route and as a middleware given for its path.
#[test]
fn hono_a_401_from_the_catch_is_the_guard_in_every_cell() {
    let guards = hono_guards();
    let head = "import type { Context, Next } from \"hono\";\nimport { HTTPException } from \"hono/http-exception\";\nimport { verify } from \"hono/jwt\";\nimport { verifyToken } from \"./tokens\";\n";
    for (attach, statements, mechanism, under) in HONO_ATTACH {
        for how in DEFINE {
            let what = format!("hono {attach} {how:?}");
            let d = define(*how, &guards, "(c: Context, next: Next)", head);
            let mut server = format!(
                "import {{ Hono }} from \"hono\";\n{}const app = new Hono();\n{}",
                d.imports, d.inline
            );
            for (g, (name, _, _)) in guards.iter().zip(&d.refs) {
                server += &statements.replace("@G@", name).replace("@R@", &g.route);
            }
            server += "app.get(\"/open\", (c) => c.json([]));\nexport default app;\n";
            let mut files = d.files.clone();
            files.insert(
                "package.json".into(),
                "{ \"name\": \"api\", \"dependencies\": { \"hono\": \"4.6.0\", \"jsonwebtoken\": \"9.0.0\" } }\n".into(),
            );
            files.insert("src/tokens.ts".into(), TOKENS.into());
            files.insert("src/server.ts".into(), server);
            let dir = write(&files);
            let r = read(dir.path(), &what);
            for (g, (_, file, name)) in guards.iter().zip(&d.refs) {
                let suffix = if *mechanism == "middleware" {
                    " (middleware)"
                } else {
                    ""
                };
                r.guarded(
                    &what,
                    &format!("{}{under}", g.route),
                    &format!("{mechanism}:{file}#{name}"),
                    &format!("{name}{suffix}"),
                );
            }
            assert_eq!(r.assignment(&what, "/open"), "none", "{what}");
        }
    }
}

// ---- NestJS -----------------------------------------------------------------------

const NEST_VERIFY: &[(&str, &str)] = &[
    (
        "bare",
        "await this.jwt.verifyAsync(request.headers.authorization);",
    ),
    (
        "assigned",
        "request.user = await this.jwt.verifyAsync<Operator>(request.headers.authorization);",
    ),
    (
        "copied",
        "const payload = await this.jwt.verifyAsync<Operator>(request.headers.authorization);\n      request.user = payload;",
    ),
];

/// [STRICT] NestJS: a guard whose `canActivate` throws `UnauthorizedException` from
/// the `catch` of the verification, on the handler, on the controller and as the
/// application's guard.
#[test]
fn nest_a_401_from_the_catch_of_can_activate_is_the_guard_in_every_cell() {
    let package = "{ \"name\": \"api\", \"dependencies\": { \"@nestjs/common\": \"10.0.0\", \"@nestjs/core\": \"10.0.0\", \"@nestjs/jwt\": \"10.0.0\" } }\n";
    let guard = |name: &str, verify: &str, catch: &str| {
        format!(
            "@Injectable()\nexport class {name} implements CanActivate {{\n  constructor(private readonly jwt: JwtService) {{}}\n  async canActivate(context: ExecutionContext): Promise<boolean> {{\n    const request = context.switchToHttp().getRequest();\n    try {{\n      {verify}\n    }} {catch}\n      throw new UnauthorizedException();\n    }}\n    return true;\n  }}\n}}\n"
        )
    };
    let head = "import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from \"@nestjs/common\";\nimport { JwtService } from \"@nestjs/jwt\";\ntype Operator = { id: string };\n";
    let mut guards = head.to_string();
    let mut on_handler = "import { Controller, Get, UseGuards } from \"@nestjs/common\";\nimport * as g from \"./guards\";\n@Controller(\"handler\")\nexport class HandlerController {\n".to_string();
    let mut on_class =
        "import { Controller, Get, UseGuards } from \"@nestjs/common\";\nimport * as g from \"./guards\";\n"
            .to_string();
    let mut cells = Vec::new();
    for (v, verify) in NEST_VERIFY {
        for (c, catch) in CATCH {
            let name = format!("Guard{}", cells.len());
            guards += &guard(&name, verify, catch);
            on_handler += &format!(
                "  @UseGuards(g.{name})\n  @Get(\"{v}/{c}\")\n  {v}_{c}() {{\n    return [];\n  }}\n"
            );
            on_class += &format!(
                "@UseGuards(g.{name})\n@Controller(\"class/{v}/{c}\")\nexport class {name}Controller {{\n  @Get()\n  list() {{\n    return [];\n  }}\n}}\n"
            );
            cells.push((name, format!("{v}/{c}")));
        }
    }
    on_handler += "  @Get(\"open\")\n  open() {\n    return [];\n  }\n}\n";
    let mut files = Files::new();
    files.insert("package.json".into(), package.into());
    files.insert("src/guards.ts".into(), guards.clone());
    files.insert("src/handler.controller.ts".into(), on_handler);
    files.insert("src/class.controller.ts".into(), on_class);
    let dir = write(&files);
    let r = read(dir.path(), "nest");
    for (name, cell) in &cells {
        let key = format!("decorator:src/guards.ts#{name}");
        r.guarded("nest handler", &format!("/handler/{cell}"), &key, name);
        r.guarded("nest class", &format!("/class/{cell}"), &key, name);
    }
    assert_eq!(r.assignment("nest", "/handler/open"), "none");

    // The application's guard, one application for each verification.
    for (v, verify) in NEST_VERIFY {
        let mut files = Files::new();
        files.insert("package.json".into(), package.into());
        files.insert(
            "src/guards.ts".into(),
            format!("{head}{}", guard("SessionGuard", verify, "catch {")),
        );
        files.insert(
            "src/app.module.ts".into(),
            "import { Module } from \"@nestjs/common\";\nimport { APP_GUARD } from \"@nestjs/core\";\nimport { SessionGuard } from \"./guards\";\nimport { ItemsController } from \"./items.controller\";\n@Module({ controllers: [ItemsController], providers: [{ provide: APP_GUARD, useClass: SessionGuard }] })\nexport class AppModule {}\n".into(),
        );
        files.insert(
            "src/items.controller.ts".into(),
            "import { Controller, Get } from \"@nestjs/common\";\n@Controller(\"items\")\nexport class ItemsController {\n  @Get()\n  list() {\n    return [];\n  }\n}\n".into(),
        );
        let dir = write(&files);
        let r = read(dir.path(), "nest app guard");
        r.guarded(
            &format!("nest app guard {v}"),
            "/items",
            "app_guard:src/guards.ts#SessionGuard",
            "SessionGuard (app hook)",
        );
    }
}

// ---- Next.js ----------------------------------------------------------------------

const NEXT_VERIFY: &[(&str, &str)] = &[
    ("bare", "await jwtVerify(token(req), key);"),
    (
        "destructured",
        "const { payload } = await jwtVerify(token(req), key);\n    seen.add(String(payload.sub));",
    ),
    (
        "member",
        "const subject = (await jwtVerify(token(req), key)).payload.sub;\n    seen.add(String(subject));",
    ),
];

const NEXT_SEND: &[(&str, &str)] = &[
    (
        "nextresponse",
        "return NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });",
    ),
    (
        "response",
        "return new Response(\"Unauthorized\", { status: 401 });",
    ),
];

/// [STRICT] Next.js: a helper that returns the 401 from the `catch` of the
/// verification, called first in the handler (from a library file and from the
/// route's own), and the same `try` written in the handler.
#[test]
fn next_a_401_from_the_catch_of_a_helper_called_first_is_the_guard_in_every_cell() {
    let head = "import { NextResponse, type NextRequest } from \"next/server\";\nimport { jwtVerify } from \"jose\";\nconst key = new TextEncoder().encode(process.env.JWT_SECRET);\nconst seen = new Set<string>();\nconst token = (req: NextRequest) => req.headers.get(\"authorization\") ?? \"\";\n";
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"14.2.0\", \"jose\": \"5.0.0\" } }\n"
            .into(),
    );
    let mut lib = head.to_string();
    let mut cells = Vec::new();
    for (v, verify) in NEXT_VERIFY {
        for (c, catch) in CATCH {
            for (s, send) in NEXT_SEND {
                let n = cells.len();
                let helper = |export: &str| {
                    format!(
                        "{export}async function guard{n}(req: NextRequest) {{\n  try {{\n    {verify}\n  }} {catch}\n    {send}\n  }}\n}}\n"
                    )
                };
                let uses = format!(
                    "export async function GET(req: NextRequest) {{\n  const denied = await guard{n}(req);\n  if (denied) return denied;\n  return NextResponse.json([]);\n}}\n"
                );
                lib += &helper("export ");
                files.insert(
                    format!("app/api/imported/{v}/{c}/{s}/route.ts"),
                    format!(
                        "import {{ NextResponse, type NextRequest }} from \"next/server\";\nimport {{ guard{n} }} from \"../../../../../../lib/auth\";\n{uses}"
                    ),
                );
                files.insert(
                    format!("app/api/same/{v}/{c}/{s}/route.ts"),
                    format!("{head}{}{uses}", helper("")),
                );
                files.insert(
                    format!("app/api/inline/{v}/{c}/{s}/route.ts"),
                    format!(
                        "{head}export async function GET(req: NextRequest) {{\n  try {{\n    {verify}\n  }} {catch}\n    {send}\n  }}\n  return NextResponse.json([]);\n}}\n"
                    ),
                );
                cells.push(format!("{v}/{c}/{s}"));
            }
        }
    }
    // In the handler itself: a 401 for some of what the `try` throws only is found
    // and not proven; a handler that swallows is nothing.
    files.insert(
        "app/api/inline/conditional/route.ts".into(),
        format!(
            "{head}export async function GET(req: NextRequest) {{\n  try {{\n    await jwtVerify(token(req), key);\n  }} catch (e) {{\n    if (e instanceof Error) return NextResponse.json({{ error: \"unauthenticated\" }}, {{ status: 401 }});\n  }}\n  return NextResponse.json([]);\n}}\n"
        ),
    );
    files.insert(
        "app/api/inline/swallows/route.ts".into(),
        format!(
            "{head}export async function GET(req: NextRequest) {{\n  try {{\n    await jwtVerify(token(req), key);\n  }} catch {{\n    seen.clear();\n  }}\n  return NextResponse.json([]);\n}}\n"
        ),
    );
    files.insert("lib/auth.ts".into(), lib);
    files.insert(
        "app/api/open/route.ts".into(),
        "import { NextResponse } from \"next/server\";\nexport async function GET() {\n  return NextResponse.json([]);\n}\n".into(),
    );
    let dir = write(&files);
    let r = read(dir.path(), "next");
    for (n, cell) in cells.iter().enumerate() {
        r.guarded(
            "next imported",
            &format!("/api/imported/{cell}"),
            &format!("body_call:lib/auth.ts#guard{n}"),
            &format!("guard{n} (body call)"),
        );
        r.guarded(
            "next same file",
            &format!("/api/same/{cell}"),
            &format!("body_call:app/api/same/{cell}/route.ts#guard{n}"),
            &format!("guard{n} (body call)"),
        );
        r.guarded(
            "next inline",
            &format!("/api/inline/{cell}"),
            "body_check:pkg:jose#jwtVerify",
            "jwtVerify (body check)",
        );
    }
    assert_eq!(r.assignment("next", "/api/inline/conditional"), "unknown");
    // The token is read and nothing is turned away: identified, not enforced, and
    // said so by its own state.
    assert_eq!(
        r.authn["GET /api/inline/swallows"],
        (
            "identified".to_string(),
            "identifies:pkg:jose#jwtVerify".to_string()
        )
    );
    assert_eq!(r.assignment("next", "/api/open"), "none");
}

// ---- What is not a guard ------------------------------------------------------------

/// [STRICT] Not a guard: a handler that swallows and goes on is nothing; a 401 under
/// a further condition of the handler, a `try` under a branch or after a return that
/// serves, a `try` that hands the request on before it verifies, and a handler after
/// which the request is handed on all the same are found and not proven. A handler
/// that only logs the words answers nothing. None is known, as a handler of the
/// route and as a hook or a middleware beside it, and the inventory says the same.
#[test]
fn a_catch_that_does_not_turn_every_caller_away_is_never_a_known_guard() {
    // (name, body, what the map says)
    let fastify_cells: &[(&str, &str, &str)] = &[
        (
            "swallows",
            "  try {\n    request.operator = await request.jwtVerify<Operator>();\n  } catch {\n    request.operator = null;\n  }\n",
            "none",
        ),
        (
            "logs",
            "  try {\n    request.operator = await request.jwtVerify<Operator>();\n  } catch (e) {\n    request.log.warn(\"Unauthorized: the token was rejected\");\n  }\n",
            "none",
        ),
        (
            "conditional",
            "  try {\n    request.operator = await request.jwtVerify<Operator>();\n  } catch (e) {\n    if (request.url.startsWith(\"/private\")) {\n      return reply.code(401).send({ error: \"unauthenticated\" });\n    }\n  }\n",
            "unknown",
        ),
        (
            "branch",
            "  if (request.headers.authorization) {\n    try {\n      request.operator = await request.jwtVerify<Operator>();\n    } catch {\n      return reply.code(401).send({ error: \"unauthenticated\" });\n    }\n  }\n",
            "unknown",
        ),
        (
            "served",
            "  if (request.method === \"OPTIONS\") return undefined;\n  try {\n    request.operator = await request.jwtVerify<Operator>();\n  } catch {\n    return reply.code(401).send({ error: \"unauthenticated\" });\n  }\n",
            "unknown",
        ),
        (
            "loop",
            "  for (const scheme of schemes) {\n    try {\n      request.operator = await scheme(request);\n    } catch {\n      return reply.code(401).send({ error: \"unauthenticated\" });\n    }\n  }\n",
            "unknown",
        ),
    ];
    let guards: Vec<Guard> = fastify_cells
        .iter()
        .map(|(name, body, _)| Guard {
            name: name.to_string(),
            route: format!("/{name}"),
            body: body.to_string(),
        })
        .collect();
    for (attach, statements, _) in FASTIFY_ATTACH {
        for how in [Define::Imported, Define::Method] {
            let what = format!("fastify {attach} {how:?}");
            let mut files = fastify(&guards, how, statements);
            let auth = files.get_mut("src/auth.ts").unwrap();
            *auth = auth.replace(
                "declare const app",
                "declare const schemes: Array<(r: FastifyRequest) => Promise<Operator>>;\ndeclare const app",
            );
            let dir = write(&files);
            let r = read(dir.path(), &what);
            for (name, _, want) in fastify_cells {
                // Options in a binding are read where the binding is an object
                // literal of the repository: what its hook holds decides, as it
                // does written on the route.
                assert_eq!(
                    r.assignment(&what, &format!("/{name}")),
                    *want,
                    "{what} {name}: {:?}",
                    r.authn[&format!("GET /{name}")]
                );
            }
        }
    }

    let express_cells: &[(&str, &str, &str)] = &[
        (
            "swallows",
            "  try {\n    req.user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);\n  } catch {\n    req.user = null;\n  }\n  next();\n",
            "none",
        ),
        (
            "logs",
            "  try {\n    req.user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);\n  } catch (e) {\n    console.warn(\"Unauthorized: the token was rejected\", e);\n  }\n  next();\n",
            "none",
        ),
        (
            "conditional",
            "  try {\n    req.user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);\n  } catch (e) {\n    if (req.path.startsWith(\"/private\")) return res.status(401).end();\n  }\n  next();\n",
            "unknown",
        ),
        (
            "branch",
            "  if (req.headers.authorization) {\n    try {\n      req.user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);\n    } catch {\n      return res.status(401).end();\n    }\n  }\n  next();\n",
            "unknown",
        ),
        (
            "hands-on",
            "  try {\n    req.user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);\n  } catch {\n    res.status(401);\n    return next();\n  }\n  next();\n",
            "unknown",
        ),
        (
            "falls-through",
            "  try {\n    req.user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);\n  } catch {\n    res.status(401).json({ error: \"unauthenticated\" });\n  }\n  next();\n",
            "unknown",
        ),
        (
            "optional",
            "  try {\n    if (!req.headers.authorization) return next();\n    req.user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);\n  } catch {\n    return res.status(401).end();\n  }\n  next();\n",
            "unknown",
        ),
        (
            "preflight",
            "  if (req.method === \"OPTIONS\") return next();\n  try {\n    req.user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);\n  } catch {\n    return res.status(401).end();\n  }\n  next();\n",
            "unknown",
        ),
        (
            "finalizer",
            "  try {\n    req.user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);\n  } catch {\n    res.status(401).json({ error: \"unauthenticated\" });\n  } finally {\n    next();\n  }\n",
            "unknown",
        ),
    ];
    let guards: Vec<Guard> = express_cells
        .iter()
        .map(|(name, body, _)| Guard {
            name: name.replace('-', "_"),
            route: format!("/{name}"),
            body: body.to_string(),
        })
        .collect();
    for (attach, statements, _, under) in EXPRESS_ATTACH {
        for how in [Define::Imported, Define::Method] {
            let what = format!("express {attach} {how:?}");
            let dir = write(&express(&guards, how, statements));
            let r = read(dir.path(), &what);
            for (name, _, want) in express_cells {
                let route = format!("/{name}{under}");
                assert_eq!(
                    r.assignment(&what, &route),
                    *want,
                    "{what} {name}: {:?}",
                    r.authn[&format!("GET {route}")]
                );
            }
        }
    }
}

/// [STRICT] A function of an object or a static method of a class is read for
/// itself where it is used as a guard: `guards.optional` beside
/// `guards.authenticate` turns no one away, and read `known` because the object as
/// a whole does.
#[test]
fn a_method_used_as_a_guard_is_read_for_itself_not_as_its_object() {
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"api\", \"dependencies\": { \"fastify\": \"5.0.0\" } }\n".into(),
    );
    files.insert(
        "src/auth.ts".into(),
        r#"import type { FastifyReply, FastifyRequest } from "fastify";
export const guards = {
  async authenticate(request: FastifyRequest, reply: FastifyReply) {
    if (!request.headers.authorization) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
  },
  async optional(request: FastifyRequest, reply: FastifyReply) {
    request.log.info("anyone");
  },
};
export const arrows = {
  authenticate: async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "unauthenticated" });
    }
  },
  optional: async (request: FastifyRequest, reply: FastifyReply) => {
    request.log.info("anyone");
  },
};
export class Auth {
  static async authenticate(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "unauthenticated" });
    }
  }
  static async optional(request: FastifyRequest, reply: FastifyReply) {
    request.log.info("anyone");
  }
}
"#
        .into(),
    );
    files.insert(
        "src/server.ts".into(),
        r#"import Fastify from "fastify";
import { Auth, arrows, guards } from "./auth";
const app = Fastify();
app.get("/method/guarded", { onRequest: guards.authenticate }, async () => []);
app.get("/method/open", { onRequest: guards.optional }, async () => []);
app.get("/arrow/guarded", { onRequest: arrows.authenticate }, async () => []);
app.get("/arrow/open", { onRequest: arrows.optional }, async () => []);
app.get("/static/guarded", { onRequest: Auth.authenticate }, async () => []);
app.get("/static/open", { onRequest: Auth.optional }, async () => []);
app.listen({ port: 3000 });
"#
        .into(),
    );
    let dir = write(&files);
    let r = read(dir.path(), "methods");
    for (route, name) in [
        ("/method/guarded", "guards.authenticate"),
        ("/arrow/guarded", "arrows.authenticate"),
        ("/static/guarded", "Auth.authenticate"),
    ] {
        r.guarded("methods", route, &format!("wrap:src/auth.ts#{name}"), name);
    }
    for route in ["/method/open", "/arrow/open", "/static/open"] {
        assert_eq!(r.assignment("methods", route), "none", "{route}");
    }
}

/// [STRICT] A wrapper that calls the function it was handed inside the `try` and
/// answers 401 for whatever it throws maps the handler's errors: the function called
/// may be what it guards, whatever its name. Found, not proven: the routes it wraps
/// are unknown, never known. The same wrapper that verifies first is the guard.
#[test]
fn a_wrapper_that_calls_what_it_was_handed_in_the_try_is_not_a_proven_guard() {
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"14.2.0\", \"jose\": \"5.0.0\" } }\n"
            .into(),
    );
    files.insert(
        "lib/wrap.ts".into(),
        r#"import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
type Inner = (req: NextRequest) => Promise<Response>;
const key = new TextEncoder().encode(process.env.JWT_SECRET);
export function mapErrors(inner: Inner) {
  return async (req: NextRequest) => {
    try {
      return await inner(req);
    } catch {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
  };
}
export function withSession(inner: Inner) {
  return async (req: NextRequest) => {
    try {
      await jwtVerify(req.headers.get("authorization") ?? "", key);
    } catch {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return inner(req);
  };
}
"#
        .into(),
    );
    for (route, wrapper) in [("mapped", "mapErrors"), ("guarded", "withSession")] {
        files.insert(
            format!("app/api/{route}/route.ts"),
            format!(
                "import {{ NextResponse }} from \"next/server\";\nimport {{ {wrapper} }} from \"../../../lib/wrap\";\nexport const GET = {wrapper}(async () => NextResponse.json([]));\n"
            ),
        );
    }
    let dir = write(&files);
    let r = read(dir.path(), "wrappers");
    assert_eq!(r.assignment("wrappers", "/api/mapped"), "unknown");
    r.guarded(
        "wrappers",
        "/api/guarded",
        "wrap:lib/wrap.ts#withSession",
        "withSession",
    );
}

// ---- NestJS middleware applied by a module ---------------------------------------------

/// A Nest application: `SessionMiddleware` (its `use` answers 401), a functional
/// `requireSession` whose 401 comes from a `catch`, a middleware that turns no one
/// away, two controllers, and this `configure` body and `main.ts`.
fn nest_app(imports: &str, configure: &str, bootstrap: &str) -> Files {
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"api\", \"dependencies\": { \"@nestjs/common\": \"10.0.0\", \"@nestjs/core\": \"10.0.0\", \"helmet\": \"7.0.0\", \"jsonwebtoken\": \"9.0.0\" } }\n".into(),
    );
    files.insert(
        "src/session.middleware.ts".into(),
        r#"import { Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import jwt from "jsonwebtoken";
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    if (!req.headers.cookie) throw new UnauthorizedException();
    next();
  }
}
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    req.id = String(Date.now());
    next();
  }
}
export function requireSession(req: any, res: any, next: () => void) {
  try {
    req.user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);
  } catch {
    return res.status(401).json({ error: "unauthenticated" });
  }
  next();
}
"#
        .into(),
    );
    files.insert(
        "src/bookings.controller.ts".into(),
        r#"import { Controller, Get, Post } from "@nestjs/common";
@Controller("bookings")
export class BookingsController {
  @Get()
  list() {
    return [];
  }
  @Post()
  create() {
    return {};
  }
  @Get(":id")
  one() {
    return {};
  }
}
"#
        .into(),
    );
    files.insert(
        "src/items.controller.ts".into(),
        r#"import { Controller, Get } from "@nestjs/common";
@Controller()
export class ItemsController {
  @Get("items")
  list() {
    return [];
  }
  @Get("availability")
  availability() {
    return "ok";
  }
}
"#
        .into(),
    );
    files.insert(
        "src/app.module.ts".into(),
        format!(
            "import {{ MiddlewareConsumer, Module, NestModule, RequestMethod }} from \"@nestjs/common\";\nimport {{ BookingsController }} from \"./bookings.controller\";\nimport {{ ItemsController }} from \"./items.controller\";\nimport {{ RequestIdMiddleware, SessionMiddleware, requireSession }} from \"./session.middleware\";\n{imports}@Module({{ controllers: [BookingsController, ItemsController] }})\nexport class AppModule implements NestModule {{\n  configure(consumer: MiddlewareConsumer) {{\n{configure}  }}\n}}\n"
        ),
    );
    files.insert(
        "src/main.ts".into(),
        format!(
            "import {{ NestFactory }} from \"@nestjs/core\";\nimport helmet from \"helmet\";\nimport {{ AppModule }} from \"./app.module\";\nimport {{ requireSession }} from \"./session.middleware\";\nasync function bootstrap() {{\n  const app = await NestFactory.create(AppModule);\n{bootstrap}  await app.listen(3000);\n}}\nbootstrap();\n"
        ),
    );
    files
}

/// The routes of [`nest_app`], in the order the expectations are written.
const NEST_ROUTES: &[(&str, &str)] = &[
    ("GET", "/bookings"),
    ("POST", "/bookings"),
    ("GET", "/bookings/:id"),
    ("GET", "/items"),
    ("GET", "/availability"),
];

/// What the map says of each route of [`NEST_ROUTES`], as one letter each: `k`
/// known by the middleware `guard`, `n` none, `u` unknown; and the inventory agrees.
fn nest_reads(what: &str, files: &Files, want: &str, guard: &str) {
    let dir = write(files);
    let v = drift(dir.path(), &["practices", "--json", "--units"]);
    let c = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .unwrap();
    read(dir.path(), what);
    let said: String = NEST_ROUTES
        .iter()
        .map(|(method, route)| {
            let u = c["units"]
                .as_array()
                .unwrap()
                .iter()
                .find(|u| u["route"] == *route && u["method"] == *method)
                .unwrap_or_else(|| panic!("{what}: no unit {method} {route}"));
            match u["assignment"].as_str().unwrap() {
                "known" => {
                    let key = u["key"].as_str().map(str::to_string).unwrap_or_else(|| {
                        c["variants"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .find(|v| v["id"] == u["variant"])
                            .and_then(|v| v["key"].as_str())
                            .unwrap_or_default()
                            .to_string()
                    });
                    assert_eq!(
                        key,
                        format!("middleware:{guard}"),
                        "{what} {method} {route}"
                    );
                    'k'
                }
                "none" => 'n',
                _ => 'u',
            }
        })
        .collect();
    assert_eq!(said, want, "{what}: {NEST_ROUTES:?}");
}

/// [STRICT] The middleware a Nest module applies in `configure` is the guard of the
/// routes `forRoutes` covers and `exclude` does not, where its body is in the
/// repository and answers 401: `consumer.apply(SessionMiddleware).exclude({ path:
/// "availability", method: RequestMethod.GET }).forRoutes("*")` read `none` for
/// every route. Where an argument is no literal Drift can match against a route (a
/// variable, a spread, a pattern, a path under a global prefix), or the chain stands
/// under a condition, the routes it may cover are unknown: never `none` for a
/// covered route, never known for one that may be excluded.
#[test]
fn nest_middleware_a_module_applies_guards_the_routes_it_covers() {
    let session = "src/session.middleware.ts#SessionMiddleware";
    let function = "src/session.middleware.ts#requireSession";
    let cases: &[(&str, &str, &str, &str, &str)] = &[
        (
            "excluded for one route",
            "",
            "    consumer.apply(SessionMiddleware).exclude({ path: \"availability\", method: RequestMethod.GET }).forRoutes(\"*\");\n",
            "kkkkn",
            session,
        ),
        (
            "excluded by a string, for every method",
            "",
            "    consumer.apply(SessionMiddleware).exclude(\"bookings\", \"/availability\").forRoutes(\"*\");\n",
            "nnkkn",
            session,
        ),
        (
            "excluded for another method",
            "",
            "    consumer.apply(SessionMiddleware).exclude({ path: \"bookings\", method: RequestMethod.POST }).forRoutes(\"*\");\n",
            "knkkk",
            session,
        ),
        (
            "a controller",
            "",
            "    consumer.apply(SessionMiddleware).forRoutes(BookingsController);\n",
            "kkknn",
            session,
        ),
        (
            "a path and a method",
            "",
            "    consumer.apply(SessionMiddleware).forRoutes({ path: \"bookings\", method: RequestMethod.GET });\n",
            "knnnn",
            session,
        ),
        (
            "a path, for what is under it",
            "",
            "    consumer.apply(SessionMiddleware).forRoutes(\"bookings\");\n",
            "kkknn",
            session,
        ),
        (
            "two middleware",
            "",
            "    consumer.apply(RequestIdMiddleware, SessionMiddleware).forRoutes(\"*\");\n",
            "kkkkk",
            session,
        ),
        (
            "a function whose 401 comes from its catch",
            "",
            "    consumer.apply(requireSession).forRoutes(\"*\");\n",
            "kkkkk",
            function,
        ),
        (
            "two chains",
            "",
            "    consumer.apply(RequestIdMiddleware).forRoutes(\"*\").apply(SessionMiddleware).forRoutes(ItemsController);\n",
            "nnnkk",
            session,
        ),
        (
            "one that turns no one away",
            "",
            "    consumer.apply(RequestIdMiddleware).forRoutes(\"*\");\n",
            "nnnnn",
            session,
        ),
        // Not literals: unknown wherever the middleware may run.
        (
            "routes in a variable",
            "const guarded = [\"bookings\"];\n",
            "    consumer.apply(SessionMiddleware).forRoutes(...guarded);\n",
            "uuuuu",
            session,
        ),
        (
            "a binding that is no controller",
            "const guarded = \"bookings\";\n",
            "    consumer.apply(SessionMiddleware).forRoutes(guarded);\n",
            "uuuuu",
            session,
        ),
        (
            "exclusions in a variable",
            "const open = [\"availability\"];\n",
            "    consumer.apply(SessionMiddleware).exclude(...open).forRoutes(\"*\");\n",
            "uuuuu",
            session,
        ),
        (
            "an exclusion that is a pattern",
            "",
            "    consumer.apply(SessionMiddleware).exclude(\"bookings/(.*)\").forRoutes(\"*\");\n",
            // `/bookings/` with nothing after the slash is `/bookings` to the router
            // and matches the pattern: the routes at `/bookings` may be excluded too.
            "uuukk",
            session,
        ),
        (
            "an exclusion for one value of a parameter",
            "",
            "    consumer.apply(SessionMiddleware).exclude(\"bookings/export\").forRoutes(\"*\");\n",
            "kkukk",
            session,
        ),
        (
            "under a condition",
            "",
            "    if (process.env.AUTH !== \"off\") {\n      consumer.apply(SessionMiddleware).forRoutes(\"*\");\n    }\n",
            "uuuuu",
            session,
        ),
    ];
    for (what, imports, configure, want, guard) in cases {
        nest_reads(what, &nest_app(imports, configure, ""), want, guard);
    }

    // On the application, in `main.ts`.
    let session_file = "src/session.middleware.ts#requireSession";
    nest_reads(
        "app.use of a function of the repository",
        &nest_app("", "", "  app.use(helmet());\n  app.use(requireSession);\n"),
        "kkkkk",
        session_file,
    );
    nest_reads(
        "app.use of a package's middleware known to turn no one away",
        &nest_app("", "", "  app.use(helmet());\n"),
        "nnnnn",
        session_file,
    );
    nest_reads(
        "app.use for a path",
        &nest_app("", "", "  app.use(\"/bookings\", requireSession);\n"),
        "kkknn",
        session_file,
    );
    // A package's middleware no list knows may be the guard.
    let mut files = nest_app("", "", "  app.use(sso());\n");
    let main = files.get_mut("src/main.ts").unwrap();
    *main = main.replace(
        "import helmet from \"helmet\";",
        "import { sso } from \"@acme/sso\";",
    );
    nest_reads(
        "app.use of a package's middleware",
        &files,
        "uuuuu",
        session_file,
    );
    // Under a global prefix the paths the routes answer at are not the paths written
    // on them: an exclusion is matched against none of them.
    nest_reads(
        "an exclusion under a global prefix",
        &nest_app(
            "",
            "    consumer.apply(SessionMiddleware).exclude(\"availability\").forRoutes(\"*\");\n",
            "  app.setGlobalPrefix(\"api\");\n",
        ),
        "uuuuu",
        session,
    );
    nest_reads(
        "every route under a global prefix",
        &nest_app(
            "",
            "    consumer.apply(SessionMiddleware).forRoutes(\"*\");\n",
            "  app.setGlobalPrefix(\"api\");\n",
        ),
        "kkkkk",
        session,
    );
}

// ---- A Node listener in front of the application ---------------------------------------

/// [STRICT] A listener written in front of an Express application answers 401 before
/// it hands the request on: `http.createServer((req, res) => { if (!signed(req)) {
/// res.statusCode = 401; return res.end() } app(req, res) }).listen(...)`. The
/// routes of the application read `none`: the listener was no part of what runs
/// before them. It is read as a middleware of the application is: the guard where
/// the 401 before the hand-over is plain, unknown where it is answered for some
/// requests only, nothing where the listener turns no one away or answers after
/// it handed the request on.
#[test]
fn a_node_listener_in_front_of_the_application_is_read() {
    // (name, src/server.ts after its imports, what the map says of GET /items)
    let cases: &[(&str, &str, &str)] = &[
        (
            "http.createServer",
            "http.createServer((req, res) => {\n  if (!signed(req)) {\n    res.statusCode = 401;\n    return res.end();\n  }\n  app(req, res);\n}).listen(3000);\n",
            "known",
        ),
        (
            "https.createServer with options",
            "https.createServer({ key: \"\", cert: \"\" }, (req, res) => {\n  if (!signed(req)) {\n    res.writeHead(401);\n    res.end();\n    return;\n  }\n  app(req, res);\n}).listen(3000);\n",
            "known",
        ),
        (
            "server.on(\"request\")",
            "const server = http.createServer();\nserver.on(\"request\", function (req, res) {\n  if (!signed(req)) {\n    res.statusCode = 401;\n    res.end();\n    return;\n  }\n  app.handle(req, res);\n});\nserver.listen(3000);\n",
            "known",
        ),
        (
            "a 401 from the catch",
            "http.createServer((req, res) => {\n  try {\n    verify(req);\n  } catch {\n    res.statusCode = 401;\n    res.end();\n    return;\n  }\n  app(req, res);\n}).listen(3000);\n",
            "known",
        ),
        (
            "for some requests only",
            "http.createServer((req, res) => {\n  if (req.url?.startsWith(\"/admin\")) {\n    if (!signed(req)) {\n      res.statusCode = 401;\n      return res.end();\n    }\n  }\n  app(req, res);\n}).listen(3000);\n",
            "unknown",
        ),
        (
            "no one is turned away",
            "http.createServer((req, res) => {\n  console.log(req.url);\n  app(req, res);\n}).listen(3000);\n",
            "none",
        ),
        (
            "after the hand-over",
            "http.createServer((req, res) => {\n  app(req, res);\n  if (!signed(req)) {\n    res.statusCode = 401;\n    res.end();\n    return;\n  }\n}).listen(3000);\n",
            "none",
        ),
        (
            "the application itself",
            "http.createServer(app).listen(3000);\n",
            "none",
        ),
    ];
    for (what, server, want) in cases {
        let mut files = Files::new();
        files.insert(
            "package.json".into(),
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n".into(),
        );
        files.insert(
            "src/app.ts".into(),
            "import express from \"express\";\nexport const app = express();\napp.get(\"/items\", (req, res) => {\n  res.json([]);\n});\n".into(),
        );
        files.insert(
            "src/server.ts".into(),
            format!(
                "import http from \"node:http\";\nimport https from \"node:https\";\nimport {{ app }} from \"./app\";\nconst signed = (req: http.IncomingMessage) => req.headers[\"x-api-key\"] === process.env.API_KEY;\nfunction verify(req: http.IncomingMessage) {{\n  if (!signed(req)) throw new Error(\"no key\");\n}}\n{server}"
            ),
        );
        let dir = write(&files);
        let r = read(dir.path(), what);
        assert_eq!(
            r.assignment(what, "/items"),
            *want,
            "{what}: {:?}",
            r.authn["GET /items"]
        );
        if *want == "known" {
            let key = &r.authn["GET /items"].1;
            assert!(
                key.starts_with("middleware:src/server.ts#listener "),
                "{what}: {key}"
            );
        }
    }

    // The application and its listener in one file.
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n".into(),
    );
    files.insert(
        "src/server.ts".into(),
        "import { createServer } from \"http\";\nimport express from \"express\";\nconst app = express();\napp.get(\"/items\", (req, res) => {\n  res.json([]);\n});\ncreateServer((req, res) => {\n  if (req.headers[\"x-api-key\"] !== process.env.API_KEY) {\n    res.statusCode = 401;\n    return res.end();\n  }\n  app(req, res);\n}).listen(3000);\n".into(),
    );
    let dir = write(&files);
    let r = read(dir.path(), "one file");
    assert_eq!(r.assignment("one file", "/items"), "known");
}

// ---- Plugins exported the CommonJS way, routes under a condition -----------------------

/// [STRICT] A Fastify plugin exported with `module.exports = async function (app)
/// { ... }` (or `exports.plugin = ...`, or a declared function exported by name)
/// has no type that says its parameter is an instance: its routes were in no
/// listing, so a route with no guard was not a route at all. They are listed where
/// the function registers a route under a path on its first parameter or calls what
/// only an instance has, under the prefix it is registered with and the hooks it
/// adds. A plugin's hook stays its own: the routes of the plugin beside it have none.
///
/// Routes a function registers under a condition are listed too. A guard written
/// on such a route is read; a hook registered under the same condition is not
/// proven for it, nor for the routes of the same instance outside the condition:
/// unknown, never known and never `none`.
#[test]
fn a_plugin_exported_the_commonjs_way_and_routes_under_a_condition_are_listed() {
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"api\", \"dependencies\": { \"fastify\": \"5.0.0\" } }\n".into(),
    );
    files.insert(
        "src/auth.js".into(),
        "async function authenticate(request, reply) {\n  try {\n    request.operator = await request.jwtVerify();\n  } catch {\n    return reply.code(401).send({ error: \"unauthenticated\" });\n  }\n}\nmodule.exports = { authenticate };\n".into(),
    );
    files.insert(
        "src/routes/items.js".into(),
        "const { authenticate } = require(\"../auth\");\nmodule.exports = async function (app) {\n  app.addHook(\"onRequest\", authenticate);\n  app.get(\"/items\", async () => []);\n};\n".into(),
    );
    files.insert(
        "src/routes/open.js".into(),
        "async function routes(server, opts) {\n  server.get(\"/open\", async () => []);\n}\nmodule.exports = routes;\n".into(),
    );
    files.insert(
        "src/routes/named.js".into(),
        "const { authenticate } = require(\"../auth\");\nexports.plugin = async function (app) {\n  app.get(\"/named\", { onRequest: authenticate }, async () => []);\n  app.get(\"/beside\", async () => []);\n};\n".into(),
    );
    files.insert(
        "src/routes/conditional.js".into(),
        "const { authenticate } = require(\"../auth\");\nmodule.exports = async function (app, opts) {\n  if (opts.secure) {\n    app.addHook(\"onRequest\", authenticate);\n    app.get(\"/secure-only\", async () => []);\n  }\n  if (process.env.ADMIN === \"1\") {\n    app.get(\"/admin\", { onRequest: authenticate }, async () => []);\n  } else {\n    app.get(\"/fallback\", async () => []);\n  }\n  app.get(\"/always\", async () => []);\n};\n".into(),
    );
    files.insert(
        "src/routes/plain.js".into(),
        "module.exports = async function (app) {\n  if (process.env.DEBUG === \"1\") {\n    app.get(\"/debug\", async () => []);\n  }\n  app.get(\"/status\", async () => []);\n};\n".into(),
    );
    // No router: a function that only reads what it is handed registers no route.
    files.insert(
        "src/settings.js".into(),
        "module.exports = function (config) {\n  return config.get(\"port\", 3000);\n};\n".into(),
    );
    files.insert(
        "src/server.js".into(),
        "const Fastify = require(\"fastify\");\nconst app = Fastify();\napp.register(require(\"./routes/items\"), { prefix: \"/v1\" });\napp.register(require(\"./routes/open\"));\napp.register(require(\"./routes/named\").plugin);\napp.register(require(\"./routes/conditional\"), { secure: true });\napp.register(require(\"./routes/plain\"));\napp.listen({ port: 3000 });\n".into(),
    );
    let dir = write(&files);
    let r = read(dir.path(), "commonjs");
    r.guarded(
        "commonjs",
        "/v1/items",
        "middleware:src/auth.js#authenticate",
        "authenticate (middleware)",
    );
    for route in ["/named", "/admin"] {
        r.guarded(
            "commonjs",
            route,
            "wrap:src/auth.js#authenticate",
            "authenticate",
        );
    }
    // A route under a condition with nothing beside it has no guard where it is
    // served, and says nothing of the routes outside the condition.
    for route in ["/open", "/beside", "/status", "/debug"] {
        assert_eq!(r.assignment("commonjs", route), "none", "{route}");
    }
    for route in ["/secure-only", "/fallback", "/always"] {
        assert_eq!(r.assignment("commonjs", route), "unknown", "{route}");
    }
    assert_eq!(r.authn.len(), 10, "{:?}", r.authn.keys());
}

// ---- NestJS guards registered on the application ---------------------------------------

/// The guard classes of the Nest fixtures: what each `canActivate` does, and what a
/// route with no decorator reads under it (`k` known, `n` none).
const NEST_GLOBAL_GUARDS: &[(&str, &str, char)] = &[
    (
        "IfGuard",
        "@Injectable()\nexport class IfGuard implements CanActivate {\n  canActivate(context: ExecutionContext): boolean {\n    const request = context.switchToHttp().getRequest();\n    if (!request.headers.authorization) throw new UnauthorizedException();\n    return true;\n  }\n}\n",
        'k',
    ),
    (
        "CatchGuard",
        "@Injectable()\nexport class CatchGuard implements CanActivate {\n  constructor(private readonly jwt: JwtService) {}\n  async canActivate(context: ExecutionContext): Promise<boolean> {\n    const request = context.switchToHttp().getRequest();\n    try {\n      request.user = await this.jwt.verifyAsync(request.headers.authorization);\n    } catch {\n      throw new UnauthorizedException();\n    }\n    return true;\n  }\n}\n",
        'k',
    ),
    (
        "PassportGuard",
        "@Injectable()\nexport class PassportGuard extends AuthGuard(\"jwt\") {}\n",
        'k',
    ),
    (
        "OpenGuard",
        "@Injectable()\nexport class OpenGuard implements CanActivate {\n  canActivate(): boolean {\n    return true;\n  }\n}\n",
        'n',
    ),
];

const NEST_GLOBAL_PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"@nestjs/common\": \"10.0.0\", \"@nestjs/core\": \"10.0.0\", \"@nestjs/jwt\": \"10.0.0\", \"@nestjs/passport\": \"10.0.0\" } }\n";

/// A Nest application with one route and [`NEST_GLOBAL_GUARDS`], this module and
/// this `main.ts`.
fn nest_global(module: &str, main: &str) -> Files {
    let mut files = Files::new();
    files.insert("package.json".into(), NEST_GLOBAL_PACKAGE.into());
    let mut guards = "import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from \"@nestjs/common\";\nimport { JwtService } from \"@nestjs/jwt\";\nimport { AuthGuard } from \"@nestjs/passport\";\n".to_string();
    for (_, class, _) in NEST_GLOBAL_GUARDS {
        guards += class;
    }
    guards += "export function makeGuard() {\n  return new IfGuard();\n}\n";
    files.insert("src/guards.ts".into(), guards);
    files.insert(
        "src/items.controller.ts".into(),
        "import { Controller, Get } from \"@nestjs/common\";\n@Controller(\"items\")\nexport class ItemsController {\n  @Get()\n  list() {\n    return [];\n  }\n}\n".into(),
    );
    files.insert("src/app.module.ts".into(), module.into());
    files.insert("src/main.ts".into(), main.into());
    files
}

const NEST_PLAIN_MODULE: &str = "import { Module } from \"@nestjs/common\";\nimport { ItemsController } from \"./items.controller\";\n@Module({ controllers: [ItemsController] })\nexport class AppModule {}\n";

/// `main.ts` with these statements between the application's creation and its
/// start, in a `bootstrap` function.
fn nest_bootstrap(body: &str) -> String {
    format!(
        "import {{ NestFactory }} from \"@nestjs/core\";\nimport {{ JwtService }} from \"@nestjs/jwt\";\nimport {{ AuthGuard }} from \"@nestjs/passport\";\nimport {{ AppModule }} from \"./app.module\";\nimport * as g from \"./guards\";\nasync function bootstrap() {{\n  const app = await NestFactory.create(AppModule);\n{body}  await app.listen(3000);\n}}\nbootstrap();\n"
    )
}

/// A `main.ts`, given how the guard is built.
type MainTs<'a> = &'a dyn Fn(&str) -> String;

/// How a guard class is built where it is registered.
fn nest_new(guard: &str) -> String {
    match guard {
        "CatchGuard" => "new g.CatchGuard(app.get(JwtService))".to_string(),
        _ => format!("new g.{guard}()"),
    }
}

/// [STRICT] `app.useGlobalGuards(new JwtAuthGuard())` in `main.ts` guards every route
/// of the application: read as a module's `APP_GUARD` provider is. The guard where
/// its `canActivate` is read to refuse (a 401 under a condition, from the `catch` of
/// the verification, `@nestjs/passport`'s by the library's meaning), nothing where
/// it turns no one away, wherever the call is written for every start of the
/// application (a `bootstrap` function, the module's top level, a `then`, a helper
/// handed the application). Unknown, never `none` and never known, where the
/// argument is no class built where it is given (a variable, a factory's result,
/// `app.get(Guard)`, `new (AuthGuard("jwt"))()`, a spread) and where the call stands
/// under a condition or after a return some starts take. `useGlobalInterceptors`,
/// `useGlobalPipes` and `useGlobalFilters` register no guard, and what a test file
/// registers is its test application's.
#[test]
fn nest_use_global_guards_is_read_as_an_app_guard_provider_is() {
    // (name, `main.ts` given how the guard is built, what it does to the reading:
    // `=` as the provider, `u` unknown where the provider is the guard, `n` none)
    let registrations: &[(&str, MainTs, char)] = &[
        (
            "in bootstrap",
            &|new| nest_bootstrap(&format!("  app.useGlobalGuards({new});\n")),
            '=',
        ),
        (
            "at the top level",
            &|new| {
                format!(
                    "import {{ NestFactory }} from \"@nestjs/core\";\nimport {{ JwtService }} from \"@nestjs/jwt\";\nimport {{ AppModule }} from \"./app.module\";\nimport * as g from \"./guards\";\nconst app = await NestFactory.create(AppModule);\napp.useGlobalGuards({new});\nawait app.listen(3000);\n"
                )
            },
            '=',
        ),
        (
            "in a then",
            &|new| {
                format!(
                    "import {{ NestFactory }} from \"@nestjs/core\";\nimport {{ JwtService }} from \"@nestjs/jwt\";\nimport {{ AppModule }} from \"./app.module\";\nimport * as g from \"./guards\";\nNestFactory.create(AppModule).then((app) => {{\n  app.useGlobalGuards({new});\n  return app.listen(3000);\n}});\n"
                )
            },
            '=',
        ),
        (
            "in a helper handed the application",
            &|new| {
                format!(
                    "import type {{ INestApplication }} from \"@nestjs/common\";\nimport {{ NestFactory }} from \"@nestjs/core\";\nimport {{ JwtService }} from \"@nestjs/jwt\";\nimport {{ AppModule }} from \"./app.module\";\nimport * as g from \"./guards\";\nfunction secure(app: INestApplication) {{\n  app.useGlobalGuards({new});\n}}\nasync function bootstrap() {{\n  const app = await NestFactory.create(AppModule);\n  secure(app);\n  await app.listen(3000);\n}}\nbootstrap();\n"
                )
            },
            '=',
        ),
        (
            "beside another guard",
            &|new| {
                nest_bootstrap(&format!(
                    "  app.useGlobalGuards(new g.OpenGuard(), {new});\n"
                ))
            },
            '=',
        ),
        (
            "a variable",
            &|new| {
                nest_bootstrap(&format!(
                    "  const guard = {new};\n  app.useGlobalGuards(guard);\n"
                ))
            },
            'U',
        ),
        (
            "a spread",
            &|new| {
                nest_bootstrap(&format!(
                    "  const guards = [{new}];\n  app.useGlobalGuards(...guards);\n"
                ))
            },
            'U',
        ),
        (
            "under a condition",
            &|new| {
                nest_bootstrap(&format!(
                    "  if (process.env.AUTH !== \"off\") {{\n    app.useGlobalGuards({new});\n  }}\n"
                ))
            },
            'u',
        ),
        (
            "the right of an and",
            &|new| {
                nest_bootstrap(&format!(
                    "  process.env.AUTH && app.useGlobalGuards({new});\n"
                ))
            },
            'u',
        ),
        (
            "after a return some starts take",
            &|new| {
                nest_bootstrap(&format!(
                    "  if (process.env.WORKER) {{\n    return app.init();\n  }}\n  app.useGlobalGuards({new});\n"
                ))
            },
            'u',
        ),
        (
            "as an interceptor, a pipe and a filter",
            &|new| {
                nest_bootstrap(&format!(
                    "  app.useGlobalInterceptors({new} as never);\n  app.useGlobalPipes({new} as never);\n  app.useGlobalFilters({new} as never);\n"
                ))
            },
            'n',
        ),
    ];
    for (guard, _, plain) in NEST_GLOBAL_GUARDS {
        // The provider: what the registration is held to.
        let module = format!(
            "import {{ Module }} from \"@nestjs/common\";\nimport {{ APP_GUARD }} from \"@nestjs/core\";\nimport {{ ItemsController }} from \"./items.controller\";\nimport {{ {guard} }} from \"./guards\";\n@Module({{ controllers: [ItemsController], providers: [{{ provide: APP_GUARD, useClass: {guard} }}] }})\nexport class AppModule {{}}\n"
        );
        let what = format!("{guard} as APP_GUARD");
        let dir = write(&nest_global(&module, &nest_bootstrap("")));
        let provider = read(dir.path(), &what);
        let key = format!("app_guard:src/guards.ts#{guard}");
        let label = format!("{guard} (app hook)");
        match plain {
            'k' => provider.guarded(&what, "/items", &key, &label),
            _ => assert_eq!(provider.assignment(&what, "/items"), "none", "{what}"),
        }
        for (name, main, effect) in registrations {
            let what = format!("{guard} {name}");
            let dir = write(&nest_global(NEST_PLAIN_MODULE, &main(&nest_new(guard))));
            let r = read(dir.path(), &what);
            match (effect, plain) {
                ('=', 'k') => r.guarded(&what, "/items", &key, &label),
                // What is given is not read: it may be a guard, whatever the class.
                ('U', _) | ('u', 'k') => assert_eq!(
                    r.assignment(&what, "/items"),
                    "unknown",
                    "{what}: {:?}",
                    r.authn["GET /items"]
                ),
                _ => assert_eq!(
                    r.assignment(&what, "/items"),
                    "none",
                    "{what}: {:?}",
                    r.authn["GET /items"]
                ),
            }
        }
    }

    // An argument that is no class built where it is given.
    for (name, argument) in [
        ("a factory's result", "g.makeGuard()"),
        ("what the container holds", "app.get(g.IfGuard)"),
        ("a class a call builds", "new (AuthGuard(\"jwt\"))()"),
    ] {
        let dir = write(&nest_global(
            NEST_PLAIN_MODULE,
            &nest_bootstrap(&format!("  app.useGlobalGuards({argument});\n")),
        ));
        let r = read(dir.path(), name);
        assert_eq!(
            r.assignment(name, "/items"),
            "unknown",
            "{name}: {:?}",
            r.authn["GET /items"]
        );
    }

    // In a test file only: the test's own application.
    let mut files = nest_global(NEST_PLAIN_MODULE, &nest_bootstrap(""));
    files.insert(
        "test/app.e2e-spec.ts".into(),
        "import { Test } from \"@nestjs/testing\";\nimport { AppModule } from \"../src/app.module\";\nimport { IfGuard } from \"../src/guards\";\ndescribe(\"app\", () => {\n  it(\"starts\", async () => {\n    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();\n    const app = moduleRef.createNestApplication();\n    app.useGlobalGuards(new IfGuard());\n    await app.init();\n  });\n});\n".into(),
    );
    let dir = write(&files);
    let r = read(dir.path(), "a test's application");
    assert_eq!(r.assignment("a test's application", "/items"), "none");
}

/// The guards of the opt-out fixtures, each with what it does about route
/// metadata, and what each route of [`NEST_OPT_OUT_ROUTES`] reads under it: `k`
/// known by the guard, `o` opened by the route's decorator, `u` unknown.
const NEST_OPT_OUT_GUARDS: &[(&str, &str, &str, &str)] = &[
    // Reads no metadata: a decorator named for a public route may be honoured by
    // what is not read, any other changes nothing.
    (
        "PlainGuard",
        "implements CanActivate",
        "@CHECK@",
        "kuukkuuuukk",
    ),
    // The documented shape, handler and class.
    (
        "BothGuard",
        "implements CanActivate",
        "    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);\n    if (isPublic) return true;\n@CHECK@",
        "kookkouookk",
    ),
    // The handler only: a decorator on the class is not read by it.
    (
        "HandlerGuard",
        "implements CanActivate",
        "    const isPublic = this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler());\n    if (isPublic) {\n      return true;\n    }\n@CHECK@",
        "kookkououkk",
    ),
    // The key as text, the read in the condition.
    (
        "InlineGuard",
        "implements CanActivate",
        "    if (this.reflector.get<boolean>(\"isPublic\", context.getHandler()) === true) return true;\n@CHECK@",
        "kookkououkk",
    ),
    (
        "PassportMetaGuard",
        "extends AuthGuard(\"jwt\")",
        "    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);\n    if (isPublic) return true;\n    return super.canActivate(context);\n",
        "kookkouookk",
    ),
    // Not the opt-out shape: what a decorator that sets the key it reads changes
    // for it is not read. A decorator of a key it never reads changes nothing.
    (
        "LateGuard",
        "implements CanActivate",
        "    const request = context.switchToHttp().getRequest();\n    if (!request.headers.authorization) throw new UnauthorizedException();\n    const isPublic = this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler());\n    if (isPublic) return true;\n    return true;\n",
        "kuukkuuuukk",
    ),
    (
        "NegatedGuard",
        "implements CanActivate",
        "    const isPublic = this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler());\n    if (!isPublic) {\n      const request = context.switchToHttp().getRequest();\n      if (!request.headers.authorization) throw new UnauthorizedException();\n    }\n    return true;\n",
        "kuukkuuuukk",
    ),
    (
        "HelperGuard",
        "implements CanActivate",
        "    if (isPublicRoute(this.reflector, context)) return true;\n@CHECK@",
        "kuuuuuuuuuu",
    ),
    // A key of another name: the routes that carry it are open, a route under a
    // decorator named for a public route is not known to be.
    (
        "SkipGuard",
        "implements CanActivate",
        "    if (this.reflector.getAllAndOverride<boolean>(SKIP_AUTH_KEY, [context.getHandler(), context.getClass()])) return true;\n@CHECK@",
        "kuukkuuuuoo",
    ),
];

/// The routes of the opt-out fixtures, in the order of the expectations: no
/// decorator; `@Public()`; a public decorator whose key is written as text;
/// `@Roles("admin")`; a decorator of another key; one composed of `Public()`; one
/// whose value is an argument; `@SetMetadata(...)` written on the handler;
/// `@Public()` on the controller class; `@SkipAuth()` on the handler and on a
/// controller class.
const NEST_OPT_OUT_ROUTES: &[&str] = &[
    "/items",
    "/items/public",
    "/items/literal-public",
    "/items/roles",
    "/items/other",
    "/items/composed",
    "/items/maybe",
    "/items/direct",
    "/open",
    "/items/skip",
    "/skipped",
];

/// A Nest application whose routes carry the decorators of
/// [`NEST_OPT_OUT_ROUTES`], with `guard` on both controllers (`@UseGuards`) or
/// none, this module and this `main.ts`.
fn nest_opt_out(on_controllers: Option<&str>, module: &str, main: &str) -> Files {
    let check = "    const request = context.switchToHttp().getRequest();\n    if (!request.headers.authorization) throw new UnauthorizedException();\n    return true;\n";
    let mut files = Files::new();
    files.insert("package.json".into(), NEST_GLOBAL_PACKAGE.into());
    // The key lives in a file of its own and is imported through a barrel.
    files.insert(
        "src/auth/constants.ts".into(),
        "export const IS_PUBLIC_KEY = \"isPublic\";\nexport const ROLES_KEY = \"roles\";\nexport const SKIP_AUTH_KEY = \"skipAuth\";\n".into(),
    );
    files.insert(
        "src/auth/index.ts".into(),
        "export * from \"./constants\";\n".into(),
    );
    files.insert(
        "src/auth/decorators.ts".into(),
        "import { SetMetadata, applyDecorators } from \"@nestjs/common\";\nimport { IS_PUBLIC_KEY, ROLES_KEY, SKIP_AUTH_KEY } from \"./constants\";\nexport const SkipAuth = () => SetMetadata(SKIP_AUTH_KEY, true);\nexport const Public = () => SetMetadata(IS_PUBLIC_KEY, true);\nexport const LiteralPublic = () => SetMetadata(\"isPublic\", true);\nexport const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);\nexport const Audited = () => SetMetadata(\"audited\", true);\nexport function PublicApi() {\n  return applyDecorators(Public(), SetMetadata(\"documented\", true));\n}\nexport const MaybePublic = (open: boolean) => SetMetadata(IS_PUBLIC_KEY, open);\n".into(),
    );
    files.insert(
        "src/auth/helpers.ts".into(),
        "import { ExecutionContext } from \"@nestjs/common\";\nimport { Reflector } from \"@nestjs/core\";\nexport function isPublicRoute(reflector: Reflector, context: ExecutionContext) {\n  return reflector.get<boolean>(\"isPublic\", context.getHandler());\n}\n".into(),
    );
    let mut guards = "import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from \"@nestjs/common\";\nimport { Reflector } from \"@nestjs/core\";\nimport { AuthGuard } from \"@nestjs/passport\";\nimport { IS_PUBLIC_KEY, SKIP_AUTH_KEY } from \"./index\";\nimport { isPublicRoute } from \"./helpers\";\n".to_string();
    for (name, base, body, _) in NEST_OPT_OUT_GUARDS {
        let constructor = if base.starts_with("extends") {
            "  constructor(private readonly reflector: Reflector) {\n    super();\n  }\n"
        } else {
            "  constructor(private readonly reflector: Reflector) {}\n"
        };
        guards += &format!(
            "@Injectable()\nexport class {name} {base} {{\n{constructor}  canActivate(context: ExecutionContext) {{\n{}  }}\n}}\n",
            body.replace("@CHECK@", check)
        );
    }
    // No `canActivate` of its own: its base's runs.
    guards += "@Injectable()\nexport class ChildGuard extends BothGuard {}\n";
    // A library's guard, whose body is not read.
    guards += "@Injectable()\nexport class LibraryGuard extends AuthGuard(\"jwt\") {}\n";
    // The opt-out is read in another method of a passport guard.
    guards += "@Injectable()\nexport class HandleRequestGuard extends AuthGuard(\"jwt\") {\n  constructor(private readonly reflector: Reflector) {\n    super();\n  }\n  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {\n    const isPublic = this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler());\n    if (isPublic) return user;\n    if (err || !user) throw new UnauthorizedException();\n    return user;\n  }\n}\n";
    files.insert("src/auth/guards.ts".into(), guards);
    let (import, use_guards) = match on_controllers {
        Some(g) => (
            format!("import {{ {g} }} from \"./auth/guards\";\n"),
            format!("@UseGuards({g})\n"),
        ),
        None => (String::new(), String::new()),
    };
    files.insert(
        "src/items.controller.ts".into(),
        format!(
            "import {{ Controller, Get, SetMetadata, UseGuards }} from \"@nestjs/common\";\nimport {{ Audited, LiteralPublic, MaybePublic, Public, PublicApi, Roles, SkipAuth }} from \"./auth/decorators\";\n{import}{use_guards}@Controller(\"items\")\nexport class ItemsController {{\n  @Get()\n  list() {{\n    return [];\n  }}\n  @Public()\n  @Get(\"public\")\n  open() {{\n    return [];\n  }}\n  @LiteralPublic()\n  @Get(\"literal-public\")\n  literal() {{\n    return [];\n  }}\n  @Roles(\"admin\")\n  @Get(\"roles\")\n  roles() {{\n    return [];\n  }}\n  @Audited()\n  @Get(\"other\")\n  other() {{\n    return [];\n  }}\n  @PublicApi()\n  @Get(\"composed\")\n  composed() {{\n    return [];\n  }}\n  @MaybePublic(false)\n  @Get(\"maybe\")\n  maybe() {{\n    return [];\n  }}\n  @SetMetadata(\"isPublic\", true)\n  @Get(\"direct\")\n  direct() {{\n    return [];\n  }}\n  @SkipAuth()\n  @Get(\"skip\")\n  skip() {{\n    return [];\n  }}\n}}\n"
        ),
    );
    files.insert(
        "src/open.controller.ts".into(),
        format!(
            "import {{ Controller, Get, UseGuards }} from \"@nestjs/common\";\nimport {{ Public }} from \"./auth/decorators\";\n{import}{use_guards}@Public()\n@Controller(\"open\")\nexport class OpenController {{\n  @Get()\n  list() {{\n    return [];\n  }}\n}}\n"
        ),
    );
    files.insert(
        "src/skipped.controller.ts".into(),
        format!(
            "import {{ Controller, Get, UseGuards }} from \"@nestjs/common\";\nimport {{ SkipAuth }} from \"./auth/decorators\";\n{import}{use_guards}@SkipAuth()\n@Controller(\"skipped\")\nexport class SkippedController {{\n  @Get()\n  list() {{\n    return [];\n  }}\n}}\n"
        ),
    );
    files.insert("src/app.module.ts".into(), module.into());
    files.insert("src/main.ts".into(), main.into());
    files
}

/// [STRICT] `@Public()` opens a route only to a guard read to honour it. A guard
/// class that runs for a Nest route (registered with `useGlobalGuards`, provided
/// as `APP_GUARD`, or given to `@UseGuards` on the controller) lets the route
/// through where its `canActivate` returns true, before it checks anything, for
/// the metadata key the route's decorator sets: `const isPublic =
/// this.reflector.getAllAndOverride(IS_PUBLIC_KEY, [context.getHandler(),
/// context.getClass()]); if (isPublic) return true;`. Then the route is public,
/// and the guard is not its guard. Under a guard that reads no such key, or reads
/// one in a way that is not followed, a route under a decorator named for a
/// public route, or one that sets the key the guard reads (or whose key or value
/// is not read), is unknown: never known, never `none`. A decorator of a key the
/// guard never reads (`@Roles("admin")` under a guard that reads `isPublic`)
/// changes nothing: the guard is the route's as it is a bare route's. So under a
/// guard that only extends `@nestjs/passport`'s, whose `canActivate` reads no
/// route metadata, and under one that reads its key in `handleRequest`.
#[test]
fn nest_a_public_decorator_opens_a_route_only_to_a_guard_read_to_honour_it() {
    let plain_module =
        "import { Module } from \"@nestjs/common\";\n@Module({})\nexport class AppModule {}\n";
    let plain_main = "import { NestFactory } from \"@nestjs/core\";\nimport { AppModule } from \"./app.module\";\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.listen(3000);\n}\nbootstrap();\n";
    let guards = NEST_OPT_OUT_GUARDS
        .iter()
        .map(|(name, _, _, want)| (*name, *want))
        .chain([
            ("ChildGuard", "kookkouookk"),
            ("LibraryGuard", "kuukkuuuukk"),
            ("HandleRequestGuard", "kuukkuuuukk"),
        ]);
    for (guard, want) in guards {
        // (how the guard is attached, the files, the mechanism, the inventory's name)
        let attached: Vec<(&str, Files, &str, String)> = vec![
            (
                "useGlobalGuards",
                nest_opt_out(
                    None,
                    plain_module,
                    &format!(
                        "import {{ NestFactory, Reflector }} from \"@nestjs/core\";\nimport {{ AppModule }} from \"./app.module\";\nimport {{ {guard} }} from \"./auth/guards\";\nasync function bootstrap() {{\n  const app = await NestFactory.create(AppModule);\n  app.useGlobalGuards(new {guard}(app.get(Reflector)));\n  await app.listen(3000);\n}}\nbootstrap();\n"
                    ),
                ),
                "app_guard",
                format!("{guard} (app hook)"),
            ),
            (
                "APP_GUARD",
                nest_opt_out(
                    None,
                    &format!(
                        "import {{ Module }} from \"@nestjs/common\";\nimport {{ APP_GUARD }} from \"@nestjs/core\";\nimport {{ {guard} }} from \"./auth/guards\";\n@Module({{ providers: [{{ provide: APP_GUARD, useClass: {guard} }}] }})\nexport class AppModule {{}}\n"
                    ),
                    plain_main,
                ),
                "app_guard",
                format!("{guard} (app hook)"),
            ),
            (
                "UseGuards",
                nest_opt_out(Some(guard), plain_module, plain_main),
                "decorator",
                guard.to_string(),
            ),
        ];
        for (how, files, mechanism, label) in attached {
            let what = format!("{guard} by {how}");
            let dir = write(&files);
            let r = read(dir.path(), &what);
            for (route, want) in NEST_OPT_OUT_ROUTES.iter().zip(want.chars()) {
                let said = &r.authn[&format!("GET {route}")];
                match want {
                    'k' => r.guarded(
                        &what,
                        route,
                        &format!("{mechanism}:src/auth/guards.ts#{guard}"),
                        &label,
                    ),
                    'o' => assert!(
                        said.0 == "known"
                            && said.1.split('+').all(|piece| piece.starts_with("opens:")),
                        "{what} {route}: {said:?}"
                    ),
                    _ => assert_eq!(said.0, "unknown", "{what} {route}: {said:?}"),
                }
            }
        }
    }

    // With no guard at all, the decorators are what they were.
    let dir = write(&nest_opt_out(None, plain_module, plain_main));
    let r = read(dir.path(), "no guard");
    for (route, want) in NEST_OPT_OUT_ROUTES.iter().zip("noonnoononn".chars()) {
        let said = &r.authn[&format!("GET {route}")];
        match want {
            'o' => assert!(
                said.0 == "known" && said.1.starts_with("opens:"),
                "no guard {route}: {said:?}"
            ),
            _ => assert_eq!(said.0, "none", "no guard {route}: {said:?}"),
        }
    }
}

// ---- A 401 handed back to the caller, and an answer after which the function goes on ----

/// The Next.js helpers that turn a caller away: the name, the body, the key the
/// response is under where it is handed back (`None` where the helper stops the
/// request itself, by a throw or a redirect).
const NEXT_HELPERS: &[(&str, &str, Option<&str>)] = &[
    (
        "requireIf",
        "  const session = await getSession(req);\n  if (!session) return NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });\n",
        Some(""),
    ),
    (
        "requireCatch",
        "  try {\n    await jwtVerify(req.headers.get(\"authorization\") ?? \"\", key);\n  } catch {\n    return NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });\n  }\n",
        Some(""),
    ),
    (
        "requireNew",
        "  const session = await getSession(req);\n  if (!session) return new Response(\"Unauthorized\", { status: 401 });\n  return null;\n",
        Some(""),
    ),
    (
        "requireObject",
        "  const session = await getSession(req);\n  if (!session) return { error: NextResponse.json({ error: \"unauthenticated\" }, { status: 401 }) };\n  return { session };\n",
        Some(".error"),
    ),
    (
        "requireThrow",
        "  const session = await getSession(req);\n  if (!session) throw new Response(\"Unauthorized\", { status: 401 });\n  return session;\n",
        None,
    ),
    (
        "requireRedirect",
        "  const session = await getSession(req);\n  if (!session) redirect(\"/login\");\n  return session;\n",
        None,
    ),
];

/// What a handler does with what the helper `@H@` handed back, and what the route
/// reads where the helper refuses by that value: `k` known, `n` none, `u` unknown.
/// For the response itself, then for a response under `.error`.
const NEXT_USES: &[(&str, &str, char)] = &[
    (
        "returned",
        "  const denied = await @H@(req);\n  if (denied) return denied;\n",
        'k',
    ),
    (
        "instanceof",
        "  const res = await @H@(req);\n  if (res instanceof Response) return res;\n",
        'k',
    ),
    (
        "block",
        "  const res = await @H@(req);\n  if (res instanceof NextResponse) {\n    return res;\n  }\n",
        'k',
    ),
    (
        "not-null",
        "  const denied = await @H@(req);\n  if (denied != null) return denied;\n",
        'k',
    ),
    (
        "later",
        "  const started = Date.now();\n  const denied = await @H@(req);\n  seen.add(started);\n  if (denied) return denied;\n",
        'k',
    ),
    // Nothing stops the handler.
    ("dropped", "  await @H@(req);\n", 'n'),
    ("not-awaited", "  @H@(req);\n", 'n'),
    ("void", "  void @H@(req);\n", 'n'),
    // Bound or tested in a way that is not read.
    ("unused", "  const denied = await @H@(req);\n", 'u'),
    (
        "logged",
        "  const denied = await @H@(req);\n  if (denied) console.log(\"denied\");\n",
        'u',
    ),
    (
        "negated",
        "  const denied = await @H@(req);\n  if (!denied) return NextResponse.json({ ok: true });\n",
        'u',
    ),
    (
        "another-answer",
        "  const denied = await @H@(req);\n  if (denied) return NextResponse.json([]);\n",
        'u',
    ),
    (
        "under-a-branch",
        "  if (req.method !== \"OPTIONS\") {\n    const denied = await @H@(req);\n    if (denied) return denied;\n  }\n",
        'u',
    ),
];

const NEXT_OBJECT_USES: &[(&str, &str, char)] = &[
    (
        "destructured",
        "  const { error } = await @H@(req);\n  if (error) return error;\n",
        'k',
    ),
    (
        "renamed",
        "  const { error: denied, session } = await @H@(req);\n  if (denied) return denied;\n  seen.add(session);\n",
        'k',
    ),
    (
        "member",
        "  const auth = await @H@(req);\n  if (auth.error) return auth.error;\n",
        'k',
    ),
    (
        "in",
        "  const auth = await @H@(req);\n  if (\"error\" in auth) return auth.error;\n",
        'k',
    ),
    ("dropped", "  await @H@(req);\n", 'n'),
    (
        "session-only",
        "  const { session } = await @H@(req);\n  seen.add(session);\n",
        'u',
    ),
    (
        "another-key",
        "  const auth = await @H@(req);\n  if (auth.session) return auth.session;\n",
        'u',
    ),
];

const NEXT_HELPER_HEAD: &str = "import { NextResponse, type NextRequest } from \"next/server\";\nimport { redirect } from \"next/navigation\";\nimport { jwtVerify } from \"jose\";\nconst key = new TextEncoder().encode(process.env.JWT_SECRET);\nasync function getSession(req: NextRequest) {\n  const token = req.cookies.get(\"session\")?.value;\n  return token ? { user: token } : null;\n}\n";

fn next_helpers() -> String {
    let mut lib = NEXT_HELPER_HEAD.to_string();
    for (name, body, _) in NEXT_HELPERS {
        lib += &format!("export async function {name}(req: NextRequest) {{\n{body}}}\n");
    }
    lib
}

/// [STRICT] A helper that returns its 401 response stops nothing by itself:
/// `export async function GET(req) { await requireSession(req); ... }` where
/// `requireSession` does `if (!session) return NextResponse.json({ error }, {
/// status: 401 })` read `known`, by the call. The call is the route's guard only
/// where the handler returns what the helper handed back when it is a response
/// (`const denied = await requireSession(req); if (denied) return denied;`, `if (res
/// instanceof Response) return res;`, `const { error } = ...; if (error) return
/// error;`). Where the call is a statement of its own nothing stops the handler:
/// the call is no guard. Where the value is bound or tested in any other way, or
/// the pair stands under a branch: unknown. A helper that throws or redirects is
/// the guard however it is called. In route handlers, server actions and
/// `middleware.ts`.
#[test]
fn next_a_helper_that_hands_back_its_401_guards_only_where_the_handler_returns_it() {
    let package =
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"14.2.0\", \"jose\": \"5.0.0\" } }\n";
    let imports = "import { NextResponse, type NextRequest } from \"next/server\";\nimport { requireCatch, requireIf, requireNew, requireObject, requireRedirect, requireThrow } from \"@/lib/auth\";\nconst seen = new Set<unknown>();\n";
    let mut files = Files::new();
    files.insert("package.json".into(), package.into());
    files.insert(
        "tsconfig.json".into(),
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }\n"
            .into(),
    );
    files.insert("lib/auth.ts".into(), next_helpers());
    let mut cells: Vec<(String, &str, char)> = Vec::new();
    for (helper, _, key) in NEXT_HELPERS {
        let uses = match key {
            Some(".error") => NEXT_OBJECT_USES,
            _ => NEXT_USES,
        };
        for (name, body, want) in uses {
            // A helper that stops the request itself is the guard however it is
            // called, where every request reaches the call.
            // (An `async` helper whose call is not awaited rejects after the handler
            // went on: found, not proven to stop anything.)
            let want = match (key, name) {
                (None, &"under-a-branch") => continue,
                (None, &"not-awaited" | &"void") => 'u',
                (None, _) => 'k',
                _ => *want,
            };
            let route = format!("/api/{helper}/{name}");
            files.insert(
                format!("app{route}/route.ts"),
                format!(
                    "{imports}export async function GET(req: NextRequest) {{\n{}  return NextResponse.json([]);\n}}\n",
                    body.replace("@H@", helper)
                ),
            );
            cells.push((route, helper, want));
        }
    }
    let dir = write(&files);
    let r = read(dir.path(), "next helpers");
    for (route, helper, want) in &cells {
        match want {
            'k' => r.guarded(
                "next helpers",
                route,
                &format!("body_call:lib/auth.ts#{helper}"),
                &format!("{helper} (body call)"),
            ),
            'n' => assert_eq!(
                r.assignment("next helpers", route),
                "none",
                "{route}: {:?}",
                r.authn[&format!("GET {route}")]
            ),
            _ => assert_eq!(
                r.assignment("next helpers", route),
                "unknown",
                "{route}: {:?}",
                r.authn[&format!("GET {route}")]
            ),
        }
    }

    // Server actions, by their names; and `await requireSession();` with nothing
    // bound and nothing handed to it.
    let mut files = Files::new();
    files.insert("package.json".into(), package.into());
    files.insert(
        "tsconfig.json".into(),
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }\n"
            .into(),
    );
    files.insert(
        "lib/session.ts".into(),
        "import { NextResponse } from \"next/server\";\nimport { cookies } from \"next/headers\";\nexport async function requireSession() {\n  const session = (await cookies()).get(\"session\");\n  if (!session) return NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });\n}\nexport async function requireUser() {\n  const session = (await cookies()).get(\"session\");\n  if (!session) throw new Error(\"Unauthorized\");\n  return session.value;\n}\n".into(),
    );
    files.insert(
        "app/actions.ts".into(),
        "\"use server\";\nimport { requireSession, requireUser } from \"@/lib/session\";\nexport async function droppedAction(input: string) {\n  await requireSession();\n  return input;\n}\nexport async function returnedAction(input: string) {\n  const denied = await requireSession();\n  if (denied) return denied;\n  return input;\n}\nexport async function thrownAction(input: string) {\n  await requireUser();\n  return input;\n}\n".into(),
    );
    files.insert(
        "app/api/report/route.ts".into(),
        "import { NextResponse } from \"next/server\";\nimport { requireSession } from \"@/lib/session\";\nexport async function GET() {\n  await requireSession();\n  return NextResponse.json([]);\n}\nexport async function POST() {\n  const denied = await requireSession();\n  if (denied) return denied;\n  return NextResponse.json({});\n}\n".into(),
    );
    let dir = write(&files);
    let practices = drift(dir.path(), &["practices", "--json", "--units"]);
    let units = practices["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .unwrap()["units"]
        .as_array()
        .unwrap()
        .clone();
    let inventory = drift(dir.path(), &["security", "--json"]);
    let said = |symbol: &str| {
        let u = units
            .iter()
            .find(|u| u["symbol"] == symbol)
            .unwrap_or_else(|| panic!("no unit {symbol}: {units:#?}"));
        let row = inventory["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["symbol"] == symbol)
            .unwrap_or_else(|| panic!("no row {symbol}"));
        (
            u["assignment"].as_str().unwrap().to_string(),
            row["guards"].as_array().map_or(0, Vec::len),
        )
    };
    assert_eq!(said("droppedAction"), ("none".to_string(), 0));
    assert_eq!(said("returnedAction"), ("known".to_string(), 1));
    assert_eq!(said("thrownAction"), ("known".to_string(), 1));
    assert_eq!(said("GET"), ("none".to_string(), 0));
    assert_eq!(said("POST"), ("known".to_string(), 1));

    // `middleware.ts`: the helper's response is the middleware's only where the
    // middleware returns it.
    for (use_, want) in [
        ("  await requireIf(req);\n", "none"),
        (
            "  const denied = await requireIf(req);\n  if (denied) return denied;\n",
            "known",
        ),
    ] {
        let mut files = Files::new();
        files.insert("package.json".into(), package.into());
        files.insert(
            "tsconfig.json".into(),
            "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }\n"
                .into(),
        );
        files.insert("lib/auth.ts".into(), next_helpers());
        files.insert(
            "middleware.ts".into(),
            format!(
                "import {{ NextResponse, type NextRequest }} from \"next/server\";\nimport {{ requireIf }} from \"@/lib/auth\";\nexport async function middleware(req: NextRequest) {{\n{use_}  return NextResponse.next();\n}}\nexport const config = {{ matcher: [\"/api/:path*\"] }};\n"
            ),
        );
        files.insert(
            "app/api/items/route.ts".into(),
            "import { NextResponse } from \"next/server\";\nexport async function GET() {\n  return NextResponse.json([]);\n}\n".into(),
        );
        let dir = write(&files);
        let said = authn(dir.path());
        assert_eq!(
            said["GET /api/items"].0, want,
            "middleware.ts {use_}: {said:?}"
        );
    }
}

/// [STRICT] The same in Hono: a helper that returns `c.json(..., 401)` guards the
/// handler, or the middleware, that returns what it handed back, and nothing where
/// the call is a statement of its own, awaited or not (`requirePartnerKey(c);`). A
/// middleware that returns the response itself is the guard as before.
#[test]
fn hono_a_helper_that_hands_back_its_401_guards_only_where_its_caller_returns_it() {
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"api\", \"dependencies\": { \"hono\": \"4.6.0\" } }\n".into(),
    );
    files.insert(
        "src/auth.ts".into(),
        "import type { Context } from \"hono\";\nexport function requirePartnerKey(c: Context) {\n  if (c.req.header(\"x-partner-key\") !== process.env.PARTNER_KEY) {\n    return c.json({ error: \"unauthenticated\" }, 401);\n  }\n}\nexport async function requireSession(c: Context) {\n  if (!c.req.header(\"authorization\")) return c.json({ error: \"unauthenticated\" }, 401);\n}\n".into(),
    );
    files.insert(
        "src/server.ts".into(),
        "import { Hono } from \"hono\";\nimport type { Context, Next } from \"hono\";\nimport { requirePartnerKey, requireSession } from \"./auth\";\nconst app = new Hono();\nasync function itself(c: Context, next: Next) {\n  if (!c.req.header(\"authorization\")) return c.json({ error: \"unauthenticated\" }, 401);\n  await next();\n}\nasync function drops(c: Context, next: Next) {\n  await requireSession(c);\n  await next();\n}\nasync function returns(c: Context, next: Next) {\n  const denied = await requireSession(c);\n  if (denied) return denied;\n  await next();\n}\napp.get(\"/dropped\", async (c) => {\n  await requireSession(c);\n  return c.json([]);\n});\napp.get(\"/dropped-not-awaited\", (c) => {\n  requirePartnerKey(c);\n  return c.json([]);\n});\napp.get(\"/returned\", async (c) => {\n  const r = await requireSession(c);\n  if (r) return r;\n  return c.json([]);\n});\napp.get(\"/returned-not-awaited\", (c) => {\n  const denied = requirePartnerKey(c);\n  if (denied) return denied;\n  return c.json([]);\n});\napp.get(\"/tested\", async (c) => {\n  const r = await requireSession(c);\n  if (r && c.req.query(\"strict\")) return r;\n  return c.json([]);\n});\napp.get(\"/middleware/itself\", itself, (c) => c.json([]));\napp.get(\"/middleware/drops\", drops, (c) => c.json([]));\napp.get(\"/middleware/returns\", returns, (c) => c.json([]));\napp.get(\"/open\", (c) => c.json([]));\nexport default app;\n".into(),
    );
    let dir = write(&files);
    let r = read(dir.path(), "hono helpers");
    r.guarded(
        "hono helpers",
        "/returned",
        "body_call:src/auth.ts#requireSession",
        "requireSession (body call)",
    );
    r.guarded(
        "hono helpers",
        "/returned-not-awaited",
        "body_call:src/auth.ts#requirePartnerKey",
        "requirePartnerKey (body call)",
    );
    for route in ["/middleware/itself", "/middleware/returns"] {
        assert_eq!(r.assignment("hono helpers", route), "known", "{route}");
    }
    for route in [
        "/dropped",
        "/dropped-not-awaited",
        "/middleware/drops",
        "/open",
    ] {
        assert_eq!(
            r.assignment("hono helpers", route),
            "none",
            "{route}: {:?}",
            r.authn[&format!("GET {route}")]
        );
    }
    assert_eq!(r.assignment("hono helpers", "/tested"), "unknown");
}

/// [STRICT] A middleware that answers 401 in a branch and goes on all the same
/// turns no one away: `if (!req.headers.authorization) { res.status(401).json({
/// error }); } next();`. Found, not proven: unknown, never known, as a handler of the
/// route and beside it, in Express and as a Fastify hook. The same branch that
/// leaves (a `return`, an `else` that holds the hand-over, a `return` after it) is
/// the guard.
#[test]
fn an_answer_after_which_the_function_goes_on_is_never_a_known_guard() {
    let answer = "res.status(401).json({ error: \"unauthenticated\" });";
    // (name, body, what the map says)
    let express_cells: &[(&str, String, &str)] = &[
        (
            "falls-through",
            format!("  if (!req.headers.authorization) {{\n    {answer}\n  }}\n  next();\n"),
            "unknown",
        ),
        (
            "one-line",
            format!("  if (!req.headers.authorization) {answer}\n  next();\n"),
            "unknown",
        ),
        (
            "hands-on-itself",
            format!(
                "  if (!req.headers.authorization) {{\n    {answer}\n    return next();\n  }}\n  next();\n"
            ),
            "unknown",
        ),
        (
            "nested",
            format!(
                "  if (req.path !== \"/health\") {{\n    if (!req.headers.authorization) {{\n      {answer}\n    }}\n  }}\n  next();\n"
            ),
            "unknown",
        ),
        (
            "returns",
            format!("  if (!req.headers.authorization) return {answer}\n  next();\n"),
            "known",
        ),
        (
            "then-returns",
            format!(
                "  if (!req.headers.authorization) {{\n    {answer}\n    return;\n  }}\n  next();\n"
            ),
            "known",
        ),
        (
            "else-hands-on",
            format!(
                "  if (!req.headers.authorization) {{\n    {answer}\n  }} else {{\n    next();\n  }}\n"
            ),
            "known",
        ),
        (
            "leaves-after-the-branches",
            format!(
                "  if (!req.headers.authorization) {{\n    if (req.accepts(\"json\")) {{\n      {answer}\n    }} else {{\n      res.status(401).end();\n    }}\n    return;\n  }}\n  next();\n"
            ),
            "known",
        ),
    ];
    let guards: Vec<Guard> = express_cells
        .iter()
        .map(|(name, body, _)| Guard {
            name: name.replace('-', "_"),
            route: format!("/{name}"),
            body: body.clone(),
        })
        .collect();
    for (attach, statements, _, under) in EXPRESS_ATTACH {
        for how in [Define::Same, Define::Imported, Define::Method] {
            let what = format!("express {attach} {how:?}");
            let dir = write(&express(&guards, how, statements));
            let r = read(dir.path(), &what);
            for (name, _, want) in express_cells {
                let route = format!("/{name}{under}");
                // A middleware is the guard by a check every request reaches: one
                // under a second branch is found, not proven, wherever the
                // middleware is given.
                let want = match *name {
                    "leaves-after-the-branches" => "unknown",
                    _ => want,
                };
                let _ = attach;
                assert_eq!(
                    r.assignment(&what, &route),
                    want,
                    "{what} {name}: {:?}",
                    r.authn[&format!("GET {route}")]
                );
            }
        }
    }

    let fastify_cells: &[(&str, &str, &str)] = &[
        (
            "falls-through",
            "  if (!request.headers.authorization) {\n    reply.code(401).send({ error: \"unauthenticated\" });\n  }\n  request.log.info(\"signed in\");\n",
            "unknown",
        ),
        (
            "returns",
            "  if (!request.headers.authorization) {\n    return reply.code(401).send({ error: \"unauthenticated\" });\n  }\n  request.log.info(\"signed in\");\n",
            "known",
        ),
        (
            "last",
            "  if (!request.headers.authorization) {\n    reply.code(401).send({ error: \"unauthenticated\" });\n  }\n",
            "known",
        ),
    ];
    let guards: Vec<Guard> = fastify_cells
        .iter()
        .map(|(name, body, _)| Guard {
            name: name.replace('-', "_"),
            route: format!("/{name}"),
            body: body.to_string(),
        })
        .collect();
    for (attach, statements, _) in FASTIFY_ATTACH {
        if *attach == "options" {
            continue;
        }
        for how in [Define::Imported, Define::Method] {
            let what = format!("fastify {attach} {how:?}");
            let dir = write(&fastify(&guards, how, statements));
            let r = read(dir.path(), &what);
            for (name, _, want) in fastify_cells {
                assert_eq!(
                    r.assignment(&what, &format!("/{name}")),
                    *want,
                    "{what} {name}: {:?}",
                    r.authn[&format!("GET /{name}")]
                );
            }
        }
    }
}

// ---- Fastify route options, read in order ---------------------------------------------

/// [STRICT] The last writer wins in a route's options, as JavaScript builds the
/// object. `{ onRequest: authenticate, ...other }` read known whatever `other`
/// held, and so did `{ onRequest: authenticate, onRequest: undefined }`. A spread
/// after the hook that is no literal of the module read to the end leaves the hook
/// unread (unknown); one that is such a literal replaces the hook where it names
/// it and leaves it where it does not; a spread before the hook changes nothing; a
/// second property of the hook's name replaces the first. And options held in a
/// binding that is an object literal of the module with no hook and no spread
/// carry no guard: the route read unknown, and is `none`.
#[test]
fn fastify_route_options_are_read_in_order_and_the_last_writer_wins() {
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"api\", \"dependencies\": { \"fastify\": \"5.0.0\", \"@fastify/jwt\": \"9.0.0\" } }\n".into(),
    );
    files.insert(
        "src/auth.ts".into(),
        "import type { FastifyReply, FastifyRequest } from \"fastify\";\nexport async function authenticate(request: FastifyRequest, reply: FastifyReply) {\n  try {\n    await request.jwtVerify();\n  } catch {\n    return reply.code(401).send({ error: \"unauthenticated\" });\n  }\n}\nexport async function audit(request: FastifyRequest) {\n  request.log.info(\"seen\");\n}\nexport const external = { onRequest: [] as never[] };\n".into(),
    );
    // (route, the options or the full declaration, what the map says)
    let routes: &[(&str, &str, &str)] = &[
        ("/plain", "{ onRequest: authenticate }", "wrap"),
        (
            "/then-a-literal-without-it",
            "{ onRequest: authenticate, ...other }",
            "wrap",
        ),
        (
            "/after-an-unread-spread",
            "{ ...unread, onRequest: authenticate }",
            "wrap",
        ),
        ("/spread", "{ ...secured }", "middleware"),
        (
            "/spread-then-another-hook",
            "{ ...secured, preHandler: audit }",
            "middleware",
        ),
        (
            "/written-twice-guard-last",
            "{ onRequest: audit, onRequest: authenticate }",
            "middleware",
        ),
        (
            "/then-an-unread-spread",
            "{ onRequest: authenticate, ...unread }",
            "unknown",
        ),
        (
            "/then-an-imported-spread",
            "{ onRequest: authenticate, ...external }",
            "unknown",
        ),
        (
            "/then-a-computed-key",
            "{ onRequest: authenticate, [hook]: audit }",
            "unknown",
        ),
        (
            "/then-a-literal-that-empties-it",
            "{ onRequest: authenticate, ...opens }",
            "none",
        ),
        (
            "/then-a-literal-that-replaces-it",
            "{ onRequest: authenticate, ...audited }",
            "none",
        ),
        (
            "/spread-then-emptied",
            "{ ...secured, onRequest: [] }",
            "none",
        ),
        (
            "/spread-then-undefined",
            "{ ...secured, onRequest: undefined }",
            "none",
        ),
        (
            "/written-twice-undefined",
            "{ onRequest: authenticate, onRequest: undefined }",
            "none",
        ),
        (
            "/written-twice-empty",
            "{ onRequest: authenticate, onRequest: [] }",
            "none",
        ),
        (
            "/written-twice-another",
            "{ onRequest: authenticate, onRequest: audit }",
            "none",
        ),
        // Options held in a binding.
        ("/binding-with-the-hook", "secured", "wrap"),
        ("/binding-without-a-hook", "other", "none"),
        ("/binding-with-a-spread", "spreads", "unknown"),
        ("/binding-not-read", "unread", "unknown"),
        // An object literal of another file, read where it is: its hook is empty.
        ("/binding-imported", "external", "none"),
    ];
    let mut server = "import Fastify from \"fastify\";\nimport { audit, authenticate, external } from \"./auth\";\nconst app = Fastify();\nconst other = { schema: {} };\nconst opens = { onRequest: [] };\nconst secured = { onRequest: authenticate };\nconst audited = { onRequest: audit };\nconst spreads = { ...other };\nconst hook = \"onRequest\";\ndeclare const unread: Record<string, unknown>;\n".to_string();
    for (route, options, _) in routes {
        server += &format!("app.get(\"{route}\", {options}, async () => []);\n");
    }
    // Declared in full.
    server += "app.route({ method: \"GET\", url: \"/full\", onRequest: authenticate, handler: async () => [] });\napp.route({ method: \"GET\", url: \"/full-then-an-unread-spread\", onRequest: authenticate, ...unread, handler: async () => [] });\napp.route({ method: \"GET\", url: \"/full-written-twice\", onRequest: authenticate, onRequest: undefined, handler: async () => [] });\napp.get(\"/open\", async () => []);\napp.listen({ port: 3000 });\n";
    files.insert("src/server.ts".into(), server);
    let dir = write(&files);
    let r = read(dir.path(), "options");
    let full = [
        ("/full", "", "wrap"),
        ("/full-then-an-unread-spread", "", "unknown"),
        ("/full-written-twice", "", "none"),
        ("/open", "", "none"),
    ];
    for (route, _, want) in routes.iter().chain(&full) {
        let said = &r.authn[&format!("GET {route}")];
        match *want {
            "wrap" | "middleware" => assert_eq!(
                (said.0.as_str(), said.1.as_str()),
                ("known", format!("{want}:src/auth.ts#authenticate").as_str()),
                "{route}"
            ),
            want => assert_eq!(said.0, want, "{route}: {said:?}"),
        }
    }
}

// ---- A Node listener declared away from `createServer` ---------------------------------

/// [STRICT] A listener declared away from where it is given: `const handler = (req,
/// res) => { if (!ok(req)) { res.statusCode = 401; return res.end() } app(req, res)
/// }; http.createServer(handler)` read `none` for every route of the application.
/// The function is read where the module binds it (an arrow bound to a name, a
/// declaration before or after the call, given to `on("request", ...)`) and where
/// another file declares and exports it. An application handed to a call whose
/// result is the listener (`createServer(wrap(app))`) went where what stands in
/// front of it is not read: unknown. `createServer(app)` is the application itself.
#[test]
fn a_node_listener_declared_away_from_create_server_is_read() {
    let guarded = "(req: http.IncomingMessage, res: http.ServerResponse) {\n  if (req.headers[\"x-api-key\"] !== process.env.API_KEY) {\n    res.statusCode = 401;\n    return res.end();\n  }\n  app(req, res);\n}\n";
    let head = "import http from \"node:http\";\nimport { app } from \"./app\";\n";
    // (name, src/server.ts, what the map says of GET /items, the file of the listener)
    let cases: Vec<(&str, String, &str, &str)> = vec![
        (
            "an arrow bound to a name",
            format!("{head}const handler = {};\nhttp.createServer(handler).listen(3000);\n", guarded.replacen(") {", ") => {", 1).trim_end()),
            "known",
            "src/server.ts",
        ),
        (
            "a declaration",
            format!("{head}function handler{guarded}http.createServer(handler).listen(3000);\n"),
            "known",
            "src/server.ts",
        ),
        (
            "a declaration after the call",
            format!("{head}http.createServer(handler).listen(3000);\nfunction handler{guarded}"),
            "known",
            "src/server.ts",
        ),
        (
            "given to on(\"request\")",
            format!("{head}function handler{guarded}const server = http.createServer();\nserver.on(\"request\", handler);\nserver.listen(3000);\n"),
            "known",
            "src/server.ts",
        ),
        (
            "imported by name",
            "import http from \"node:http\";\nimport { guarded } from \"./listener\";\nhttp.createServer(guarded).listen(3000);\n".to_string(),
            "known",
            "src/listener.ts",
        ),
        (
            "imported as the default export",
            "import https from \"node:https\";\nimport listener from \"./listener\";\nhttps.createServer({ key: \"\", cert: \"\" }, listener).listen(3000);\n".to_string(),
            "known",
            "src/listener.ts",
        ),
        (
            "an imported listener that turns no one away",
            "import http from \"node:http\";\nimport { open } from \"./listener\";\nhttp.createServer(open).listen(3000);\n".to_string(),
            "none",
            "",
        ),
        (
            "a named listener that turns no one away",
            format!("{head}const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {{\n  console.log(req.url);\n  app(req, res);\n}};\nhttp.createServer(handler).listen(3000);\n"),
            "none",
            "",
        ),
        (
            "the result of a call handed the application",
            format!("{head}declare function wrap(inner: unknown): http.RequestListener;\nhttp.createServer(wrap(app)).listen(3000);\n"),
            "unknown",
            "",
        ),
        (
            "the application itself",
            format!("{head}http.createServer(app).listen(3000);\n"),
            "none",
            "",
        ),
        // Exported and given to no server: no listener of the application.
        (
            "an exported function nothing gives to a server",
            format!("{head}import \"./listener\";\nhttp.createServer(app).listen(3000);\n"),
            "none",
            "",
        ),
    ];
    for (what, server, want, file) in &cases {
        let mut files = Files::new();
        files.insert(
            "package.json".into(),
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n".into(),
        );
        files.insert(
            "src/app.ts".into(),
            "import express from \"express\";\nexport const app = express();\napp.get(\"/items\", (req, res) => {\n  res.json([]);\n});\n".into(),
        );
        files.insert(
            "src/listener.ts".into(),
            format!("import type http from \"node:http\";\nimport {{ app }} from \"./app\";\nexport function guarded{guarded}export function open(req: http.IncomingMessage, res: http.ServerResponse) {{\n  app(req, res);\n}}\nexport default guarded;\n"),
        );
        files.insert("src/server.ts".into(), server.clone());
        let dir = write(&files);
        let r = read(dir.path(), what);
        assert_eq!(
            r.assignment(what, "/items"),
            *want,
            "{what}: {:?}",
            r.authn["GET /items"]
        );
        if *want == "known" {
            let key = &r.authn["GET /items"].1;
            assert!(
                key.starts_with(&format!("middleware:{file}#listener ")),
                "{what}: {key}"
            );
        }
    }
}

// ---- Routes registered in a loop or a `switch`, and untyped ES plugins -----------------

/// [STRICT] A route that is not listed cannot be judged. Routes a function
/// registers in a loop or a `switch` were in no listing, nor were those of a
/// Fastify plugin exported the ES way from plain JavaScript (`export default async
/// function (app) { app.get("/items", ...) }`), whatever its parameter is called.
/// They are listed: under their path where it is a literal and an unknown one
/// (`/?`) where it is not, for every method where the method is computed
/// (`app[r.method](r.path, r.handler)`). What is registered in a loop or a
/// `switch` leaves the routes of that instance with something unread: unknown,
/// never `none`. A function that only reads what it is handed registers nothing.
#[test]
fn routes_in_a_loop_or_a_switch_and_untyped_es_plugins_are_listed() {
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"api\", \"type\": \"module\", \"dependencies\": { \"fastify\": \"5.0.0\" } }\n"
            .into(),
    );
    files.insert(
        "src/auth.js".into(),
        "export async function authenticate(request, reply) {\n  try {\n    request.operator = await request.jwtVerify();\n  } catch {\n    return reply.code(401).send({ error: \"unauthenticated\" });\n  }\n}\n".into(),
    );
    files.insert(
        "src/routes/items.js".into(),
        "export default async function (app) {\n  app.get(\"/items\", async () => []);\n}\n".into(),
    );
    files.insert(
        "src/routes/arrow.js".into(),
        "import { authenticate } from \"../auth.js\";\nexport default async (server) => {\n  server.get(\"/arrow\", { onRequest: authenticate }, async () => []);\n  server.get(\"/arrow/open\", async () => []);\n};\n".into(),
    );
    files.insert(
        "src/routes/named.js".into(),
        "import { authenticate } from \"../auth.js\";\nexport async function plugin(f) {\n  f.addHook(\"onRequest\", authenticate);\n  f.post(\"/named\", async () => ({}));\n}\nasync function later(api) {\n  api.get(\"/later\", async () => []);\n}\nexport { later };\n".into(),
    );
    files.insert(
        "src/routes/sync.js".into(),
        "export default function (app, opts, done) {\n  app.get(\"/sync\", (req, reply) => reply.send([]));\n  done();\n}\n".into(),
    );
    files.insert(
        "src/routes/loops.js".into(),
        "const paths = [\"/x\", \"/y\"];\nexport default async function (app, opts) {\n  for (const p of paths) app.get(p, async () => []);\n  for (const name of [\"a\", \"b\"]) {\n    app.get(\"/in-a-loop\", async () => []);\n  }\n  switch (opts.kind) {\n    case \"admin\":\n      app.get(\"/in-a-case\", async () => []);\n      break;\n    default:\n      app.get(\"/in-the-default\", async () => []);\n  }\n  app.get(\"/beside-the-loop\", async () => []);\n}\n".into(),
    );
    files.insert(
        "src/routes/table.ts".into(),
        "import type { FastifyInstance } from \"fastify\";\nconst table = [{ method: \"get\", path: \"/t\", handler: async () => [] }];\nexport default async function (app: FastifyInstance) {\n  for (const r of table) app[r.method](r.path, r.handler);\n  table.forEach((r) => app.get(r.path, r.handler));\n}\n".into(),
    );
    // No router: a function that only reads what it is handed registers no route.
    files.insert(
        "src/settings.js".into(),
        "export default function (config) {\n  return config.get(\"port\", 3000);\n}\n".into(),
    );
    files.insert(
        "src/server.js".into(),
        "import Fastify from \"fastify\";\nimport items from \"./routes/items.js\";\nimport arrow from \"./routes/arrow.js\";\nimport { later, plugin } from \"./routes/named.js\";\nimport sync from \"./routes/sync.js\";\nimport loops from \"./routes/loops.js\";\nimport table from \"./routes/table.js\";\nconst app = Fastify();\napp.register(items, { prefix: \"/v1\" });\napp.register(arrow);\napp.register(plugin);\napp.register(later);\napp.register(sync);\napp.register(loops);\napp.register(table);\napp.listen({ port: 3000 });\n".into(),
    );
    let dir = write(&files);
    let v = drift(dir.path(), &["practices", "--json", "--units"]);
    let units = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .unwrap()["units"]
        .as_array()
        .unwrap()
        .clone();
    // The inventory lists the same routes, and agrees on each.
    read(dir.path(), "listings");
    let said = |method: &str, route: &str, path: &str| -> String {
        units
            .iter()
            .find(|u| u["method"] == method && u["route"] == route && u["path"] == path)
            .unwrap_or_else(|| panic!("no unit {method} {route} in {path}: {units:#?}"))["assignment"]
            .as_str()
            .unwrap()
            .to_string()
    };
    for (method, route, path, want) in [
        ("GET", "/v1/items", "src/routes/items.js", "none"),
        ("GET", "/arrow", "src/routes/arrow.js", "known"),
        ("GET", "/arrow/open", "src/routes/arrow.js", "none"),
        ("POST", "/named", "src/routes/named.js", "known"),
        ("GET", "/later", "src/routes/named.js", "none"),
        ("GET", "/sync", "src/routes/sync.js", "none"),
        // In a loop or a `switch`, and beside one: listed, guard unknown.
        ("GET", "/?", "src/routes/loops.js", "unknown"),
        ("GET", "/in-a-loop", "src/routes/loops.js", "unknown"),
        ("GET", "/in-a-case", "src/routes/loops.js", "unknown"),
        ("GET", "/in-the-default", "src/routes/loops.js", "unknown"),
        ("GET", "/beside-the-loop", "src/routes/loops.js", "unknown"),
        // A computed method: every method, an unknown path.
        ("ALL", "/?", "src/routes/table.ts", "unknown"),
        ("GET", "/?", "src/routes/table.ts", "unknown"),
    ] {
        assert_eq!(
            said(method, route, path),
            want,
            "{method} {route} in {path}"
        );
    }
    assert_eq!(units.len(), 13, "{units:#?}");
}

// ---- Guard positions: position x provenance x framework --------------------------------

mod guard_positions;

/// [STRICT] What stands at a guard position and is not recognised is unknown, never
/// nothing; a library's guard is one only in a call shape on the closed list. Express:
/// every thing of `guard_positions::express` at every position.
#[test]
fn guard_positions_express() {
    guard_positions::check(&guard_positions::EXPRESS);
}

/// [STRICT] The same for Fastify (`guard_positions::fastify`).
#[test]
fn guard_positions_fastify() {
    guard_positions::check(&guard_positions::FASTIFY);
}

/// [STRICT] The same for Hono (`guard_positions::hono`).
#[test]
fn guard_positions_hono() {
    guard_positions::check(&guard_positions::HONO);
}

/// [STRICT] The same for tRPC: what a procedure is given with `.use(...)`, in its
/// own chain and through the procedures it is derived from
/// (`guard_positions::trpc`).
#[test]
fn guard_positions_trpc() {
    guard_positions::check(&guard_positions::TRPC_ROUTERS);
}

/// [STRICT] The same for what wraps an exported Next.js route handler
/// (`guard_positions::next`).
#[test]
fn guard_positions_next_wrappers() {
    guard_positions::check(&guard_positions::NEXT_WRAPPERS);
}

/// [STRICT] The same for the guard classes of NestJS, on a method, on a controller
/// and among several (`guard_positions::nest`): a guard class is read by its body,
/// never by its name, and `AuthGuard(...)` by the shape it is called in.
#[test]
fn guard_positions_nest() {
    guard_positions::check(&guard_positions::NEST);
}

// ---- A Next.js layout above a page -------------------------------------------------------

/// What every layout of the layout matrix starts with: its function is on line 6.
const LAYOUT_HEAD: &str = "import { auth } from \"@clerk/nextjs/server\";\nimport { getServerSession } from \"next-auth\";\nimport { redirect, permanentRedirect } from \"next/navigation\";\nimport { flags } from \"@/lib/flags\";\n\n";

/// A layout whose body is `body`, before it renders its children.
fn layout(body: &str) -> String {
    format!(
        "{LAYOUT_HEAD}export default async function Layout({{ children }}: {{ children: React.ReactNode }}) {{\n  {body}\n  return <section>{{children}}</section>;\n}}\n"
    )
}

const PAGE: &str = "export default async function Page() {\n  return <div />;\n}\n";
const ROUTE: &str = "export async function GET() {\n  return Response.json({ ok: true });\n}\n";

/// What the layout does before it renders, and whether that turns away whoever is
/// not signed in (the inventory reads the layout as guarded).
const LAYOUT_FORMS: &[(&str, &str, bool)] = &[
    (
        "clerk-redirect",
        "const { userId } = await auth();\n  if (!userId) {\n    redirect(\"/sign-in\");\n  }",
        true,
    ),
    (
        "session-redirect-template",
        "const session = await getServerSession();\n  if (!session) redirect(`/login?next=${encodeURIComponent(\"/x\")}`);",
        true,
    ),
    (
        "redirect-to-sign-in",
        "const { userId, redirectToSignIn } = await auth();\n  if (!userId) return redirectToSignIn();",
        true,
    ),
    (
        "permanent-redirect",
        "const session = await getServerSession();\n  if (!session) {\n    permanentRedirect(\"/login\");\n  }",
        true,
    ),
    ("protect", "await auth.protect();", true),
    // On something else than a session: to the home page, no sign-in redirect.
    (
        "flag-redirect-home",
        "if (!flags.beta) {\n    redirect(\"/\");\n  }",
        false,
    ),
    // On something else, to the sign-in page: the condition is not read, so the
    // layout may turn away whoever is not signed in (the inventory reads it so).
    (
        "flag-redirect-sign-in",
        "if (!flags.beta) {\n    redirect(\"/sign-in\");\n  }",
        true,
    ),
    ("renders-only", "console.log(\"layout\");", false),
];

/// Where the pages are, relative to the cell's directory `app/cN`: each with the
/// layout above it that decides (`None`: no guarded layout is above it). `@L@` is
/// where the cell's layout is written; `inner` puts a second, plain layout under it.
struct LayoutArrangement {
    name: &'static str,
    layout: &'static str,
    inner: Option<&'static str>,
    /// Page directories, and whether the cell's layout is above them.
    pages: &'static [(&'static str, bool)],
}

const LAYOUT_ARRANGEMENTS: &[LayoutArrangement] = &[
    LayoutArrangement {
        name: "beside",
        layout: "",
        inner: None,
        pages: &[("", true)],
    },
    LayoutArrangement {
        name: "depth-1",
        layout: "",
        inner: None,
        pages: &[("a", true)],
    },
    LayoutArrangement {
        name: "depth-2",
        layout: "",
        inner: None,
        pages: &[("a/b", true)],
    },
    // The guarded layout two levels up, a plain one in between: the outer decides.
    LayoutArrangement {
        name: "depth-2-nested",
        layout: "",
        inner: Some("a"),
        pages: &[("a/b", true), ("a", true)],
    },
    // The guarded layout is the inner one: the page beside the outer is outside it.
    LayoutArrangement {
        name: "inner-only",
        layout: "a",
        inner: None,
        pages: &[("a/b", true), ("", false)],
    },
    // A route group: the layout of `(signed)` is above its pages, not its siblings'.
    LayoutArrangement {
        name: "route-group",
        layout: "(signed)",
        inner: None,
        pages: &[("(signed)/a", true), ("open", false)],
    },
];

/// [STRICT] A Next.js page with no guard of its own under a layout that turns away
/// whoever is not signed in is `unknown`, never "no guard found" and never guarded: a
/// layout and its page render in parallel and a layout is not run again on a client
/// navigation, so the layout is not proven to stop the page's own server work. The
/// inventory names the reason (`layout_may_redirect`) and the layout's file and line.
/// A page under a layout with no guard still reads no guard found, and a route handler
/// under a guarded layout is not under it at all. Matrix: what the layout does (redirect
/// forms; on the session or on something else) x where the page is (beside the layout,
/// one and two levels below, below a second layout, a route group).
#[test]
fn a_page_under_a_layout_that_turns_away_whoever_is_not_signed_in_is_unknown() {
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\", \"@clerk/nextjs\": \"6.0.0\", \"next-auth\": \"4.24.0\", \"react\": \"19.0.0\" } }\n".into(),
    );
    files.insert(
        "tsconfig.json".into(),
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }\n"
            .into(),
    );
    files.insert(
        "lib/flags.ts".into(),
        "export const flags = { beta: process.env.BETA === \"1\" };\n".into(),
    );
    let join = |a: &str, b: &str| match (a.is_empty(), b.is_empty()) {
        (true, _) => b.to_string(),
        (_, true) => a.to_string(),
        _ => format!("{a}/{b}"),
    };
    // (page path, the layout path it is under, or None) and the route handlers.
    let mut pages: Vec<(String, Option<String>, String)> = Vec::new();
    let mut routes: Vec<String> = Vec::new();
    let mut n = 0;
    for (form, body, guarded) in LAYOUT_FORMS {
        for a in LAYOUT_ARRANGEMENTS {
            n += 1;
            let cell = format!("app/c{n}");
            let at = join(&cell, a.layout);
            let layout_path = format!("{at}/layout.tsx");
            files.insert(layout_path.clone(), layout(body));
            if let Some(inner) = a.inner {
                files.insert(
                    format!("{}/layout.tsx", join(&at, inner)),
                    layout("console.log(\"inner\");"),
                );
            }
            for (dir, under) in a.pages {
                let page = format!("{}/page.tsx", join(&cell, dir));
                files.insert(page.clone(), PAGE.to_string());
                pages.push((
                    page,
                    (*under && *guarded).then(|| format!("{layout_path}:6")),
                    format!("{form} / {}", a.name),
                ));
            }
            let route = format!("{at}/export/route.ts");
            files.insert(route.clone(), ROUTE.to_string());
            routes.push(route);
        }
    }
    let dir = write(&files);
    let r = dir.path();
    let inv = drift(r, &["security", "--json"]);
    let row = |path: &str| -> &Value {
        inv["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["path"] == path)
            .unwrap_or_else(|| panic!("no row {path}"))
    };
    let mut failures = Vec::new();
    for (page, under, cell) in &pages {
        let e = row(page);
        let opaque: Vec<&str> = e["opaque"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|o| o.as_str().unwrap())
            .collect();
        let ok = match under {
            // Unknown: no guard is claimed, the reason and the layout are named.
            Some(layout) => {
                e["guards"] == serde_json::json!([])
                    && opaque.len() == 1
                    && opaque[0].starts_with("layout_may_redirect: ")
                    && opaque[0].contains(&format!("({layout})"))
                    && e.get("basis").is_none()
            }
            None => e["guards"] == serde_json::json!([]) && opaque.is_empty(),
        };
        if !ok {
            failures.push(format!("{cell}: {page} (under {under:?}): {e}"));
        }
    }
    // A route handler is not under a layout: what it was, on both surfaces.
    let map = authn(r);
    for route in &routes {
        let e = row(route);
        let key = format!("GET {}", e["route"].as_str().unwrap());
        if e["guards"] != serde_json::json!([])
            || e.get("opaque").is_some()
            || map.get(&key).map(|(a, _)| a.as_str()) != Some("none")
        {
            failures.push(format!("{route}: {e} / {:?}", map.get(&key)));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} cells fail:\n{}",
        failures.len(),
        pages.len() + routes.len(),
        failures.join("\n")
    );

    // The text: such a page is listed apart from "no guard found", with the reason.
    let out = Command::new(&*BIN)
        .args(["--no-cache", "security"])
        .current_dir(r)
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    let (none, unknown) = text
        .split_once("\nEntry points whose guard cannot be read")
        .unwrap_or_else(|| panic!("{text}"));
    let (page, layout) = pages
        .iter()
        .find_map(|(p, l, _)| Some((p, l.as_ref()?)))
        .unwrap();
    assert!(!none.contains(&format!("  {page}:")), "{text}");
    let line = unknown
        .lines()
        .find(|l| l.contains(&format!("  {page}:")))
        .unwrap_or_else(|| panic!("{text}"));
    assert!(
        line.contains(&format!("opaque: layout_may_redirect: the layout above it ({layout}) turns away whoever is not signed in; Next.js does not guarantee that stops this page")),
        "{line}"
    );
    // The card says the same.
    let out = Command::new(&*BIN)
        .args(["--no-cache", "card", page])
        .current_dir(r)
        .output()
        .unwrap();
    let card = String::from_utf8_lossy(&out.stdout);
    assert!(
        card.contains(&format!(
            "[page] default: guard unknown (opaque: layout_may_redirect: the layout above it ({layout})"
        )),
        "{card}"
    );
}

// ---- A handler that is no function of the repository ------------------------------------

/// [STRICT] A Next.js route whose handler is the value a package's call built
/// (`export const { GET, POST } = initApiPassthrough({ ... })`), or a binding that
/// names no function, has no body in the facts: unknown on both surfaces, never
/// "no guard". A handler written or named in the repository is read as before.
#[test]
fn a_handler_a_call_built_is_never_without_a_guard() {
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\", \"langgraph-nextjs-api-passthrough\": \"0.1.0\" } }\n".into(),
    );
    for (route, source) in [
        (
            "built",
            "import { initApiPassthrough } from \"langgraph-nextjs-api-passthrough\";\nexport const { GET, POST } = initApiPassthrough({ apiUrl: process.env.API_URL });\n",
        ),
        (
            "built-one",
            "import { serve } from \"langgraph-nextjs-api-passthrough\";\nexport const GET = serve({ apiUrl: process.env.API_URL });\n",
        ),
        (
            "member",
            "import { handlers } from \"langgraph-nextjs-api-passthrough\";\nexport const GET = handlers.GET;\n",
        ),
        (
            "written",
            "export const GET = async () => Response.json([]);\n",
        ),
        (
            "named",
            "async function list() {\n  return Response.json([]);\n}\nexport const GET = list;\n",
        ),
        (
            "declared",
            "export async function GET() {\n  return Response.json([]);\n}\n",
        ),
    ] {
        files.insert(format!("app/api/{route}/route.ts"), source.into());
    }
    let dir = write(&files);
    let r = read(dir.path(), "handlers");
    for route in ["/api/built", "/api/built-one", "/api/member"] {
        assert_eq!(
            r.assignment("handlers", route),
            "unknown",
            "{route}: {:?}",
            r.authn[&format!("GET {route}")]
        );
    }
    assert_eq!(r.authn["POST /api/built"].0, "unknown");
    for route in ["/api/written", "/api/named", "/api/declared"] {
        assert_eq!(
            r.assignment("handlers", route),
            "none",
            "{route}: {:?}",
            r.authn[&format!("GET {route}")]
        );
    }
}

// ---- A function a Fastify instance is decorated with ------------------------------------

/// [STRICT] `fastify.decorate("authenticate", async function (request, reply) { try {
/// await request.jwtVerify() } catch (err) { reply.send(err) } })`, the form of the
/// `@fastify/jwt` README, given as `{ onRequest: [fastify.authenticate] }` in another
/// file: the route read `none`. The decorated function is read where the repository
/// decorates the name once with a function; the caught verification error handed
/// to `reply.send` is the library's 401. A decorated function that swallows what it
/// caught refuses no one, and a member nothing in the repository decorates is
/// unknown.
#[test]
fn fastify_a_decorated_function_is_read_where_it_is_given_as_a_hook() {
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"api\", \"dependencies\": { \"fastify\": \"5.0.0\", \"fastify-plugin\": \"5.0.0\", \"@fastify/jwt\": \"9.0.0\" } }\n".into(),
    );
    files.insert(
        "src/plugins/auth.ts".into(),
        "import fp from \"fastify-plugin\";\nimport jwt from \"@fastify/jwt\";\nexport default fp(async (fastify) => {\n  fastify.register(jwt, { secret: process.env.JWT_SECRET! });\n  fastify.decorate(\"authenticate\", async function (request: any, reply: any) {\n    try {\n      await request.jwtVerify();\n    } catch (err) {\n      reply.send(err);\n    }\n  });\n  fastify.decorate(\"optional\", async function (request: any) {\n    try {\n      await request.jwtVerify();\n    } catch (err) {\n      request.log.info(err);\n    }\n  });\n  fastify.decorate(\"twice\", async function () {});\n  fastify.decorate(\"twice\", async function (request: any, reply: any) {\n    if (!request.headers.authorization) return reply.code(401).send();\n  });\n});\n".into(),
    );
    files.insert(
        "src/routes/items.ts".into(),
        "import type { FastifyInstance } from \"fastify\";\nexport default async function items(fastify: FastifyInstance) {\n  fastify.get(\"/items\", { onRequest: [fastify.authenticate] }, async () => []);\n  fastify.get(\"/single\", { preHandler: fastify.authenticate }, async () => []);\n  fastify.get(\"/optional\", { onRequest: [fastify.optional] }, async () => []);\n  fastify.get(\"/twice\", { onRequest: [fastify.twice] }, async () => []);\n  fastify.get(\"/not-decorated\", { onRequest: [(fastify as any).verifyAdmin] }, async () => []);\n  fastify.get(\"/open\", async () => []);\n}\n".into(),
    );
    files.insert(
        "src/server.ts".into(),
        "import Fastify from \"fastify\";\nimport auth from \"./plugins/auth\";\nimport items from \"./routes/items\";\nconst app = Fastify();\napp.register(auth);\napp.register(items);\napp.listen({ port: 3000 });\n".into(),
    );
    let dir = write(&files);
    let r = read(dir.path(), "decorated");
    for (route, want) in [
        ("/items", "known"),
        ("/single", "known"),
        ("/optional", "none"),
        ("/twice", "unknown"),
        ("/not-decorated", "unknown"),
        ("/open", "none"),
    ] {
        assert_eq!(
            r.assignment("decorated", route),
            want,
            "{route}: {:?}",
            r.authn[&format!("GET {route}")]
        );
    }
}

// ---- Routes under a prefix, a base path or several paths --------------------------------

/// A route that is not listed under the path it answers at cannot be judged. A
/// Fastify plugin registered with a prefix is listed under it, in the file that
/// registers it and in another, and only its own routes are (two plugins of one
/// file each keep their prefix); `new Hono().basePath("/api")` bases every route of
/// the router; `app.use(["/a", "/b"], router)`, `app.get(["/p", "/q"], h)`,
/// `@Controller(["items", "things"])` and `@Get(["a", "b"])` list one route for each
/// path.
#[test]
fn routes_under_a_prefix_a_base_path_or_several_paths_are_listed() {
    let routes = |files: &[(&str, &str)]| -> Vec<String> {
        let files: Files = files
            .iter()
            .map(|(p, b)| ((*p).to_string(), (*b).to_string()))
            .collect();
        let dir = write(&files);
        let r = read(dir.path(), "listing");
        r.authn.keys().cloned().collect()
    };
    let fastify = "{ \"name\": \"api\", \"dependencies\": { \"fastify\": \"5.0.0\" } }\n";
    assert_eq!(
        routes(&[
            ("package.json", fastify),
            (
                "src/routes.ts",
                "import type { FastifyInstance } from \"fastify\";\nexport default async function routes(app: FastifyInstance) {\n  app.get(\"/items\", async () => []);\n}\nexport async function named(app: FastifyInstance) {\n  app.get(\"/named\", async () => []);\n}\n",
            ),
            (
                "src/server.ts",
                "import Fastify, { type FastifyInstance } from \"fastify\";\nimport routes, { named } from \"./routes\";\nasync function local(instance: FastifyInstance) {\n  instance.get(\"/local\", async () => []);\n}\nconst app = Fastify();\napp.register(routes, { prefix: \"/v1\" });\napp.register(named, { prefix: \"/v2\" });\napp.register(local, { prefix: \"/v3\" });\napp.register(async (instance) => {\n  instance.get(\"/inline\", async () => []);\n}, { prefix: \"/v4\" });\napp.get(\"/root\", async () => []);\n",
            ),
        ]),
        [
            "GET /root",
            "GET /v1/items",
            "GET /v2/named",
            "GET /v3/local",
            "GET /v4/inline"
        ]
    );
    assert_eq!(
        routes(&[
            (
                "package.json",
                "{ \"name\": \"api\", \"dependencies\": { \"hono\": \"4.6.0\" } }\n"
            ),
            (
                "src/server.ts",
                "import { Hono } from \"hono\";\nconst api = new Hono().basePath(\"/api\");\napi.get(\"/items\", (c) => c.json([]));\nconst v2 = new Hono().basePath(\"/v2\");\nv2.get(\"/users\", (c) => c.json([]));\napi.route(\"/\", v2);\nexport default api;\n",
            ),
        ]),
        ["GET /api/items", "GET /api/v2/users"]
    );
    assert_eq!(
        routes(&[
            (
                "package.json",
                "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n"
            ),
            (
                "src/server.ts",
                "import express from \"express\";\nconst app = express();\nconst router = express.Router();\nrouter.get(\"/items\", (_req, res) => res.json([]));\napp.use([\"/a\", \"/b\"], router);\napp.get([\"/p\", \"/q\"], (_req, res) => res.json([]));\n",
            ),
        ]),
        ["GET /a/items", "GET /b/items", "GET /p", "GET /q"]
    );
    assert_eq!(
        routes(&[
            (
                "package.json",
                "{ \"name\": \"api\", \"dependencies\": { \"@nestjs/common\": \"10.0.0\", \"@nestjs/core\": \"10.0.0\" } }\n"
            ),
            (
                "src/items.controller.ts",
                "import { Controller, Get } from \"@nestjs/common\";\n@Controller([\"items\", \"things\"])\nexport class ItemsController {\n  @Get()\n  list() {\n    return [];\n  }\n\n  @Get([\"a\", \"b\"])\n  both() {\n    return [];\n  }\n}\n",
            ),
        ]),
        [
            "GET /items",
            "GET /items/a",
            "GET /items/b",
            "GET /things",
            "GET /things/a",
            "GET /things/b"
        ]
    );
}

/// What the practice map says of authorization, by route.
fn authz(root: &Path) -> BTreeMap<String, String> {
    let v = drift(root, &["practices", "--json", "--units"]);
    let c = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authz")
        .expect("no authz concern");
    c["units"]
        .as_array()
        .unwrap_or_else(|| panic!("no units: {c:#}"))
        .iter()
        .map(|u| (unit_key(u), u["assignment"].as_str().unwrap().to_string()))
        .collect()
}

/// Authorization: what may scope or refuse and is not read is never the absence of
/// a check. A callback of `router.param`, a filter by a value an accessor of the
/// claims gave, a filter in one arm of a conditional, and a check that is one of
/// several an `or` of guards holds; a sibling with none of them has none.
#[test]
fn authorization_at_a_position_or_in_a_filter_that_is_not_read_is_never_none() {
    let said = |files: &[(&str, &str)]| -> BTreeMap<String, String> {
        let files: Files = files
            .iter()
            .map(|(p, b)| ((*p).to_string(), (*b).to_string()))
            .collect();
        let dir = write(&files);
        authz(dir.path())
    };
    let param = said(&[
        (
            "package.json",
            "{ \"name\": \"e4\", \"dependencies\": { \"express\": \"4.19.0\" } }\n",
        ),
        (
            "src/db.ts",
            "import { PrismaClient } from \"@prisma/client\";\nexport const db = new PrismaClient();\n",
        ),
        (
            "src/server.ts",
            "import express from \"express\";\nimport { db } from \"./db\";\nconst app = express();\nfunction requireUser(req: any, res: any, next: any) {\n  if (!req.user) return res.status(401).end();\n  next();\n}\nconst router = express.Router();\nrouter.use(requireUser);\nrouter.param(\"payoutId\", async (req: any, res: any, next: any, id: string) => {\n  const payout = await db.payout.findUnique({ where: { id } });\n  if (!payout || payout.merchantId !== req.user.merchantId) {\n    return res.status(403).json({ error: \"forbidden\" });\n  }\n  req.payout = payout;\n  next();\n});\nrouter.get(\"/payouts/:payoutId\", (req: any, res: any) => res.json(req.payout));\nrouter.get(\"/payouts\", async (req: any, res: any) => res.json(await db.payout.findMany()));\nrouter.get(\"/health/:id\", (req: any, res: any) => res.json({}));\napp.use(\"/api\", router);\n",
        ),
    ]);
    assert_ne!(param["GET /api/payouts/:payoutId"], "none", "router.param");
    assert_eq!(param["GET /api/payouts"], "none", "no parameter");
    assert_eq!(param["GET /api/health/:id"], "none", "another parameter");

    let filters = said(&[
        (
            "package.json",
            "{ \"name\": \"e5\", \"dependencies\": { \"express\": \"4.19.0\", \"express-jwt\": \"8.4.1\", \"knex\": \"3.0.0\" } }\n",
        ),
        (
            "src/server.ts",
            "import express from \"express\";\nimport { expressjwt } from \"express-jwt\";\nimport knex from \"knex\";\nconst db = knex({ client: \"pg\" });\nconst app = express();\napp.use(expressjwt({ secret: \"s\", algorithms: [\"HS256\"] }));\nfunction claimsOf(req: any) {\n  return req.auth as { merchantId: string; role: string };\n}\napp.get(\"/payouts\", async (req, res) => {\n  const claims = claimsOf(req);\n  res.json(await db(\"payouts\").where({ merchant_id: claims.merchantId }));\n});\napp.get(\"/brands\", async (req: any, res) => {\n  const role = req.auth.role;\n  const brandId = req.auth.brandId;\n  res.json(await db(\"brands\").where(role === \"admin\" ? {} : { brand_id: brandId }));\n});\napp.get(\"/all\", async (_req, res) => {\n  res.json(await db(\"payouts\").select());\n});\n",
        ),
    ]);
    assert_ne!(filters["GET /payouts"], "none", "a filter by the claims");
    assert_ne!(filters["GET /brands"], "none", "a filter in one arm");
    assert_eq!(filters["GET /all"], "none", "no filter");

    let held = said(&[
        (
            "package.json",
            "{ \"name\": \"f3\", \"dependencies\": { \"fastify\": \"5.0.0\", \"@fastify/auth\": \"5.0.0\", \"@fastify/jwt\": \"9.0.0\", \"@prisma/client\": \"5.0.0\" } }\n",
        ),
        (
            "src/server.ts",
            "import Fastify from \"fastify\";\nimport { PrismaClient } from \"@prisma/client\";\nconst prisma = new PrismaClient();\nconst app = Fastify();\nasync function verifyJwt(request: any, reply: any) {\n  try { await request.jwtVerify(); } catch { return reply.code(401).send(); }\n}\nasync function verifyApiKey(request: any, reply: any) {\n  if (!request.headers[\"x-api-key\"]) return reply.code(401).send();\n}\nasync function ownsInvoice(request: any, reply: any) {\n  const invoice = await prisma.invoice.findUnique({ where: { id: request.params.id } });\n  if (!invoice || invoice.ownerId !== request.user.id) {\n    return reply.code(403).send();\n  }\n}\napp.get(\"/invoices/:id\", { preHandler: app.auth([verifyJwt, verifyApiKey]) }, async () => ({}));\napp.route({ method: \"GET\", url: \"/invoices/:id/pdf\", preHandler: app.auth([verifyJwt, ownsInvoice]), handler: async () => ({}) });\napp.get(\"/and/:id\", { preHandler: app.auth([verifyJwt, ownsInvoice], { relation: \"and\" }) }, async () => ({}));\napp.get(\"/alone/:id\", { onRequest: verifyJwt, preHandler: ownsInvoice }, async () => ({}));\n",
        ),
    ]);
    assert_eq!(held["GET /invoices/:id/pdf"], "unknown", "one of an or");
    assert_eq!(held["GET /and/:id"], "known", "one of an and");
    assert_eq!(held["GET /alone/:id"], "known", "a hook of its own");
    assert_eq!(held["GET /invoices/:id"], "none", "two that only sign in");
}

/// Next.js: the middleware runs for the path a request asks for, not for the path
/// a rewrite of `next.config` sends it to. A route a rewrite reaches from a path
/// the matcher leaves out is not proven guarded by the middleware; neither is any
/// route it covers where what `rewrites` returns is not read. A rewrite from a
/// path the matcher takes, or to another host, changes nothing.
#[test]
fn next_a_rewrite_from_outside_the_matcher_leaves_the_middleware_unproven() {
    let route = "export async function GET() {\n  return Response.json([]);\n}\n";
    let said = |config: &str| -> BTreeMap<String, (String, String)> {
        let files: Files = [
            ("package.json", "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\", \"next-auth\": \"4.24.0\" } }\n"),
            ("middleware.ts", "import { NextResponse, type NextRequest } from \"next/server\";\nexport function middleware(req: NextRequest) {\n  if (!req.cookies.get(\"session\")) {\n    return new NextResponse(null, { status: 401 });\n  }\n  return NextResponse.next();\n}\nexport const config = { matcher: [\"/api/admin/:path*\", \"/api/reports/:path*\", \"/api/ext/:path*\", \"/guarded-in/:path*\"] };\n"),
            ("next.config.mjs", config),
            ("app/api/admin/users/route.ts", route),
            ("app/api/reports/daily/route.ts", route),
            ("app/api/open/route.ts", route),
        ]
        .iter()
        .map(|(p, b)| ((*p).to_string(), (*b).to_string()))
        .collect();
        let dir = write(&files);
        authn(dir.path())
    };
    let known = "middleware:middleware.ts#middleware";
    let state = |r: &BTreeMap<String, (String, String)>, route: &str| -> (String, String) {
        r[&format!("GET {route}")].clone()
    };
    let is = |a: &str, b: &str| (a.to_string(), b.to_string());

    let literal = said(
        "const nextConfig = {\n  async rewrites() {\n    return [\n      { source: \"/open/:path*\", destination: \"/api/admin/:path*\" },\n      { source: \"/guarded-in/:path*\", destination: \"/api/reports/:path*\" },\n      { source: \"/out/:path*\", destination: \"https://example.com/:path*\" },\n    ];\n  },\n};\nexport default nextConfig;\n",
    );
    assert_eq!(
        state(&literal, "/api/admin/users"),
        is("unknown", "unresolved")
    );
    assert_eq!(state(&literal, "/api/reports/daily"), is("known", known));
    assert_eq!(state(&literal, "/api/open"), is("none", ""));

    let unread = said(
        "import { rules } from \"./rules.mjs\";\nexport default {\n  rewrites: async () => ({ beforeFiles: rules, afterFiles: [{ source: \"/x\", destination: `${process.env.API}/x` }] }),\n};\n",
    );
    assert_eq!(
        state(&unread, "/api/admin/users"),
        is("unknown", "unresolved")
    );
    assert_eq!(
        state(&unread, "/api/reports/daily"),
        is("unknown", "unresolved")
    );
    assert_eq!(state(&unread, "/api/open"), is("none", ""));

    let elsewhere = said(
        "export default { reactStrictMode: true, rewrites: async () => [{ source: \"/out/:path*\", destination: `https://example.com/${\"x\"}` }] };\n",
    );
    assert_eq!(state(&elsewhere, "/api/admin/users"), is("known", known));
    assert_eq!(state(&elsewhere, "/api/reports/daily"), is("known", known));

    let none = said("export default { reactStrictMode: true };\n");
    assert_eq!(state(&none, "/api/admin/users"), is("known", known));

    // The assignment form is read as the key is.
    let assigned = said(
        "const nextConfig = { reactStrictMode: true };\nnextConfig.rewrites = async () => [{ source: \"/open/:path*\", destination: \"/api/admin/:path*\" }];\nexport default nextConfig;\n",
    );
    assert_eq!(
        state(&assigned, "/api/admin/users"),
        is("unknown", "unresolved")
    );
    assert_eq!(state(&assigned, "/api/reports/daily"), is("known", known));

    // A wrapper of the configuration may add rewrites of its own: not read, but
    // for the wrappers on the closed list of those that add none.
    for wrapped in [
        "import withProxy from \"@acme/next-proxy\";\nexport default withProxy({ reactStrictMode: true });\n",
        "import { withRoutes } from \"./with-routes.mjs\";\nconst nextConfig = { reactStrictMode: true };\nexport default withRoutes(nextConfig);\n",
        "const withProxy = require(\"@acme/next-proxy\")({ target: \"/api\" });\nmodule.exports = withProxy({ reactStrictMode: true });\n",
        "import { withSentryConfig } from \"@sentry/nextjs\";\nimport withProxy from \"@acme/next-proxy\";\nexport default withSentryConfig(withProxy({ reactStrictMode: true }), {});\n",
    ] {
        let r = said(wrapped);
        assert_eq!(
            state(&r, "/api/admin/users"),
            is("unknown", "unresolved"),
            "{wrapped}"
        );
        assert_eq!(
            state(&r, "/api/reports/daily"),
            is("unknown", "unresolved"),
            "{wrapped}"
        );
        assert_eq!(state(&r, "/api/open"), is("none", ""), "{wrapped}");
    }
    for listed in [
        "import { withSentryConfig } from \"@sentry/nextjs\";\nexport default withSentryConfig({ reactStrictMode: true }, { silent: true });\n",
        "import bundleAnalyzer from \"@next/bundle-analyzer\";\nconst withBundleAnalyzer = bundleAnalyzer({ enabled: false });\nexport default withBundleAnalyzer({ reactStrictMode: true });\n",
        "const withBundleAnalyzer = require(\"@next/bundle-analyzer\")({ enabled: false });\nconst { withSentryConfig } = require(\"@sentry/nextjs\");\nmodule.exports = withSentryConfig(withBundleAnalyzer({ reactStrictMode: true }), {});\n",
        "import createNextIntlPlugin from \"next-intl/plugin\";\nexport default createNextIntlPlugin()({ reactStrictMode: true });\n",
    ] {
        let r = said(listed);
        assert_eq!(
            state(&r, "/api/admin/users"),
            is("known", known),
            "{listed}"
        );
    }

    // Rewrites beside a base path: which path each is matched under is not read.
    let based = said(
        "export default { basePath: \"/app\", rewrites: async () => [{ source: \"/out/:path*\", destination: \"https://example.com/:path*\" }] };\n",
    );
    assert_eq!(
        state(&based, "/api/admin/users"),
        is("unknown", "unresolved")
    );
    let based_alone = said("export default { basePath: \"/app\", reactStrictMode: true };\n");
    assert_eq!(state(&based_alone, "/api/admin/users"), is("known", known));
}

/// What is found and does not stop the request is never a known guard: a helper
/// that answers 401 on the response it was handed where the handler drops what it
/// returns and goes on (directly, and through a second helper), and an answer in a
/// short circuit after which the middleware calls `next()`. The same helper where
/// the handler leaves on its answer, and a middleware that returns its 401, guard.
#[test]
fn express_an_answer_the_caller_goes_on_after_is_never_a_known_guard() {
    let said = |server: &str| {
        let files: Files = [
            (
                "package.json",
                "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n",
            ),
            ("src/server.ts", server),
        ]
        .iter()
        .map(|(p, b)| ((*p).to_string(), (*b).to_string()))
        .collect();
        let dir = write(&files);
        read(dir.path(), "goes on")
    };
    let dropped = said(
        "import express from \"express\";\nconst app = express();\nfunction ensureUser(req: any, res: any): boolean {\n  if (!req.headers.authorization) {\n    res.status(401).json({ error: \"unauthenticated\" });\n    return false;\n  }\n  return true;\n}\napp.get(\"/dropped\", (req, res) => {\n  ensureUser(req, res);\n  res.json([]);\n});\napp.get(\"/checked\", (req, res) => {\n  if (!ensureUser(req, res)) return;\n  res.json([]);\n});\napp.get(\"/open\", (_req, res) => {\n  res.json([]);\n});\n",
    );
    assert_eq!(dropped.assignment("dropped", "/dropped"), "unknown");
    assert_eq!(dropped.assignment("checked", "/checked"), "known");
    assert_eq!(dropped.assignment("open", "/open"), "none");

    let second = said(
        "import express from \"express\";\nconst app = express();\nfunction check(req: any): { ok: boolean } {\n  if (!req.headers.authorization) return { ok: false };\n  return { ok: true };\n}\nfunction gate(req: any, res: any): boolean {\n  const r = check(req);\n  if (!r.ok) {\n    res.status(401).end();\n    return false;\n  }\n  return true;\n}\nfunction gate2(req: any, res: any): boolean {\n  return gate(req, res);\n}\napp.get(\"/second\", (req, res) => {\n  if (!gate2(req, res)) return;\n  res.json([]);\n});\napp.get(\"/second-dropped\", (req, res) => {\n  gate2(req, res);\n  res.json([]);\n});\napp.get(\"/open\", (_req, res) => {\n  res.json([]);\n});\n",
    );
    assert_eq!(
        second.assignment("second dropped", "/second-dropped"),
        "unknown"
    );
    assert_eq!(second.assignment("second", "/second"), "known");
    assert_eq!(second.assignment("open", "/open"), "none");

    // A helper handed the continuation, or a function written in place, refuses by
    // not going on; where the handler itself goes on after the call, what follows
    // runs whatever the helper answered.
    let handed = said(
        "import express from \"express\";\nconst app = express();\nfunction ensure(req: any, res: any, next: any) {\n  if (!req.headers.authorization) {\n    res.status(401).json({ error: \"unauthenticated\" });\n    return;\n  }\n  next();\n}\napp.get(\"/in-place-goes-on\", (req, res) => {\n  ensure(req, res, () => {});\n  res.json([]);\n});\napp.get(\"/continuation-goes-on\", (req, res, next) => {\n  ensure(req, res, next);\n  res.json([]);\n});\napp.get(\"/in-place-rest\", (req, res) => {\n  ensure(req, res, () => {\n    res.json([]);\n  });\n});\napp.get(\"/continuation-last\", (req, res, next) => {\n  ensure(req, res, next);\n}, (_req, res) => {\n  res.json([]);\n});\napp.get(\"/open\", (_req, res) => {\n  res.json([]);\n});\n",
    );
    assert_eq!(
        handed.assignment("in place, goes on", "/in-place-goes-on"),
        "unknown"
    );
    assert_eq!(
        handed.assignment("continuation, goes on", "/continuation-goes-on"),
        "unknown"
    );
    assert_eq!(
        handed.assignment("the rest in place", "/in-place-rest"),
        "known"
    );
    assert_eq!(
        handed.assignment("continuation, last", "/continuation-last"),
        "known"
    );
    assert_eq!(handed.assignment("open", "/open"), "none");

    // The second helper in a module of its own, the first in another.
    let files: Files = [
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n",
        ),
        (
            "src/gate.ts",
            "export function gate(req: any, res: any): boolean {\n  if (!req.headers.authorization) {\n    res.status(401).end();\n    return false;\n  }\n  return true;\n}\n",
        ),
        (
            "src/gate2.ts",
            "import { gate } from \"./gate\";\nexport function gate2(req: any, res: any): boolean {\n  return gate(req, res);\n}\n",
        ),
        (
            "src/server.ts",
            "import express from \"express\";\nimport { gate2 } from \"./gate2\";\nconst app = express();\napp.get(\"/second\", (req, res) => {\n  if (!gate2(req, res)) return;\n  res.json([]);\n});\napp.get(\"/second-dropped\", (req, res) => {\n  gate2(req, res);\n  res.json([]);\n});\napp.get(\"/open\", (_req, res) => {\n  res.json([]);\n});\n",
        ),
    ]
    .iter()
    .map(|(p, b)| ((*p).to_string(), (*b).to_string()))
    .collect();
    let dir = write(&files);
    let across = read(dir.path(), "a second helper of another module");
    assert_eq!(
        across.assignment("second dropped, across modules", "/second-dropped"),
        "unknown"
    );
    assert_eq!(
        across.assignment("second, across modules", "/second"),
        "known"
    );
    assert_eq!(across.assignment("open", "/open"), "none");

    let short = said(
        "import express from \"express\";\nconst app = express();\nfunction soft(req: any, res: any, next: any) {\n  const ok = Boolean(req.headers.authorization);\n  !ok && res.status(401).end();\n  next();\n}\nfunction hard(req: any, res: any, next: any) {\n  const ok = Boolean(req.headers.authorization);\n  if (!ok) return res.status(401).end();\n  next();\n}\napp.get(\"/soft\", soft, (_req, res) => res.json([]));\napp.get(\"/hard\", hard, (_req, res) => res.json([]));\napp.get(\"/open\", (_req, res) => res.json([]));\n",
    );
    assert_eq!(short.assignment("short circuit", "/soft"), "unknown");
    assert_eq!(short.assignment("returns", "/hard"), "known");
    assert_eq!(short.assignment("open", "/open"), "none");
}

/// NestJS: `useGlobalGuards` guards the routes of the application it is called on.
/// In a helper that is handed an application, or in a package that builds two
/// applications, which routes that is cannot be told: found, not proven.
#[test]
fn nest_use_global_guards_on_an_application_that_is_not_the_only_one_built_is_not_proven() {
    let said = |main: &str| {
        let files: Files = [
            ("package.json", "{ \"name\": \"api\", \"dependencies\": { \"@nestjs/common\": \"10.0.0\", \"@nestjs/core\": \"10.0.0\" } }\n"),
            ("src/auth.guard.ts", "import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from \"@nestjs/common\";\n@Injectable()\nexport class AuthGuard implements CanActivate {\n  canActivate(context: ExecutionContext): boolean {\n    const req = context.switchToHttp().getRequest();\n    if (!req.headers.authorization) {\n      throw new UnauthorizedException();\n    }\n    return true;\n  }\n}\n"),
            ("src/items.controller.ts", "import { Controller, Get } from \"@nestjs/common\";\n@Controller(\"items\")\nexport class ItemsController {\n  @Get()\n  list() {\n    return [];\n  }\n}\n"),
            ("src/app.module.ts", "import { Module } from \"@nestjs/common\";\nimport { ItemsController } from \"./items.controller\";\n@Module({ controllers: [ItemsController] })\nexport class AppModule {}\n"),
            ("src/main.ts", main),
        ]
        .iter()
        .map(|(p, b)| ((*p).to_string(), (*b).to_string()))
        .collect();
        let dir = write(&files);
        read(dir.path(), "global guards")
    };
    let helper = said(
        "import { NestFactory } from \"@nestjs/core\";\nimport type { INestApplication } from \"@nestjs/common\";\nimport { AppModule } from \"./app.module\";\nimport { AuthGuard } from \"./auth.guard\";\nexport function secure(app: INestApplication) {\n  app.useGlobalGuards(new AuthGuard());\n}\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.listen(3000);\n}\nbootstrap();\n",
    );
    assert_eq!(
        helper.assignment("a helper nothing calls", "/items"),
        "unknown"
    );
    let two = said(
        "import { NestFactory } from \"@nestjs/core\";\nimport { AppModule } from \"./app.module\";\nimport { AuthGuard } from \"./auth.guard\";\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  app.useGlobalGuards(new AuthGuard());\n  await app.listen(3000);\n  const admin = await NestFactory.create(AppModule);\n  await admin.listen(3001);\n}\nbootstrap();\n",
    );
    assert_eq!(
        two.assignment("one of two applications", "/items"),
        "unknown"
    );
    let one = said(
        "import { NestFactory } from \"@nestjs/core\";\nimport { AppModule } from \"./app.module\";\nimport { AuthGuard } from \"./auth.guard\";\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  app.useGlobalGuards(new AuthGuard());\n  await app.listen(3000);\n}\nbootstrap();\n",
    );
    assert_eq!(one.assignment("the only application", "/items"), "known");
}

/// A middleware given for a path with a parameter (`app.use("/orgs/:id/admin",
/// guard)`): whether that path takes a route is not evaluated, so it is never the
/// proven guard of a route or of a router mounted beside it. A route or a mount a
/// segment written out sets apart (`/public/health`, `/mounted`) has nothing; one
/// the path can take is unknown. By name and as a call of a library's guard, in
/// Express and in Hono.
#[test]
fn a_guard_given_for_a_path_with_a_parameter_guards_nothing_the_path_cannot_take() {
    let said = |package: &str, server: &str| {
        let files: Files = [
            ("package.json", package),
            (
                "src/auth.ts",
                "export function requireAdmin(req: any, res: any, next: any) {\n  if (!req.headers.authorization) {\n    res.status(401).json({ error: \"unauthenticated\" });\n    return;\n  }\n  next();\n}\n",
            ),
            ("src/server.ts", server),
        ]
        .iter()
        .map(|(p, b)| ((*p).to_string(), (*b).to_string()))
        .collect();
        let dir = write(&files);
        read(dir.path(), "a path with a parameter")
    };
    let express = "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"express-jwt\": \"8.4.1\" } }\n";
    for (what, guard) in [
        ("by name", "requireAdmin"),
        (
            "a library call",
            "expressjwt({ secret, algorithms: [\"HS256\"] })",
        ),
    ] {
        let r = said(
            express,
            &format!(
                "import express from \"express\";\nimport {{ expressjwt }} from \"express-jwt\";\nimport {{ requireAdmin }} from \"./auth\";\nconst secret = process.env.JWT_SECRET!;\nconst h = (_req: any, res: any) => res.json([]);\nconst app = express();\nconst mounted = express.Router();\nmounted.get(\"/items\", h);\nconst under = express.Router();\nunder.get(\"/items\", h);\napp.use(\"/orgs/:id/admin\", {guard});\napp.get(\"/public/health\", h);\napp.get(\"/orgs/1/admin/users\", h);\napp.use(\"/mounted\", mounted);\napp.use(\"/orgs/1/admin/more\", under);\n"
            ),
        );
        assert_eq!(r.assignment(what, "/mounted/items"), "none", "{what}");
        assert_eq!(r.assignment(what, "/public/health"), "none", "{what}");
        assert_eq!(
            r.assignment(what, "/orgs/1/admin/users"),
            "unknown",
            "{what}"
        );
        assert_eq!(
            r.assignment(what, "/orgs/1/admin/more/items"),
            "unknown",
            "{what}"
        );
    }
    let hono = "{ \"name\": \"api\", \"dependencies\": { \"hono\": \"4.6.0\" } }\n";
    let r = said(
        hono,
        "import { Hono } from \"hono\";\nimport { jwt } from \"hono/jwt\";\nconst secret = process.env.JWT_SECRET!;\nconst h = (c: any) => c.json([]);\nconst app = new Hono();\nconst mounted = new Hono();\nmounted.get(\"/items\", h);\nconst under = new Hono();\nunder.get(\"/items\", h);\napp.use(\"/orgs/:id/admin/*\", jwt({ secret }));\napp.get(\"/public/health\", h);\napp.get(\"/orgs/1/admin/users\", h);\napp.route(\"/mounted\", mounted);\napp.route(\"/orgs/1/admin/more\", under);\nexport default app;\n",
    );
    assert_eq!(r.assignment("hono", "/mounted/items"), "none");
    assert_eq!(r.assignment("hono", "/public/health"), "none");
    assert_eq!(r.assignment("hono", "/orgs/1/admin/users"), "unknown");
    assert_eq!(r.assignment("hono", "/orgs/1/admin/more/items"), "unknown");
}

/// A middleware given for a path that does not take a mount's prefix but goes on
/// under it may run for some of the mounted routes: `app.use("/api", guard)` beside a
/// router mounted with no path, `app.use("/api/admin", guard)` beside one mounted at
/// `/api`. Those routes are never said to have no guard (unknown), and a parameter in
/// either path never makes the guard proven.
#[test]
fn a_guard_given_for_a_path_under_a_mount_may_run_for_its_routes() {
    let files: Files = [
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n",
        ),
        (
            "src/auth.ts",
            "export function requireUser(req: any, res: any, next: any) {\n  if (!req.headers.authorization) {\n    res.status(401).json({ error: \"unauthenticated\" });\n    return;\n  }\n  next();\n}\n",
        ),
        (
            "src/server.ts",
            "import express from \"express\";\nimport { requireUser } from \"./auth\";\nconst h = (_req: any, res: any) => res.json([]);\nconst a = express();\na.use(\"/api\", requireUser);\nconst ra = express.Router();\nra.get(\"/api/x\", h);\na.use(ra);\nconst b = express();\nb.use(\"/orgs/:id\", requireUser);\nconst rb = express.Router();\nrb.get(\"/orgs/1/y\", h);\nb.use(rb);\nconst c = express();\nc.use(\"/c/admin\", requireUser);\nconst rc = express.Router();\nrc.get(\"/admin/x\", h);\nc.use(\"/c\", rc);\nconst d = express();\nd.use(\"/v/:id/admin\", requireUser);\nconst rd = express.Router();\nrd.get(\"/admin/x\", h);\nd.use(\"/v/:id\", rd);\nconst e = express();\ne.use(\"/e/admin\", requireUser);\nconst re = express.Router();\nre.get(\"/x\", h);\ne.use(\"/e/open\", re);\nexport default a;\n",
        ),
    ]
    .iter()
    .map(|(p, b)| ((*p).to_string(), (*b).to_string()))
    .collect();
    let dir = write(&files);
    let r = read(dir.path(), "a path under a mount");
    assert_eq!(r.assignment("no path, literal", "/api/x"), "unknown");
    assert_eq!(r.assignment("no path, parameter", "/orgs/1/y"), "unknown");
    assert_eq!(r.assignment("deeper, literal", "/c/admin/x"), "unknown");
    assert_eq!(
        r.assignment("deeper, parameter", "/v/:id/admin/x"),
        "unknown"
    );
    assert_eq!(r.assignment("set apart", "/e/open/x"), "none");
}

/// A route added with Hono's `app.openapi(...)` is read with what its router runs
/// before it, as one added by its verb: a middleware given for a path that takes it
/// (under the router's base), what a call the router is handed to registers
/// (`setup(app)`), and what has no name (unknown).
#[test]
fn an_openapi_route_is_read_with_what_its_router_runs_before_it() {
    let files: Files = [
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"hono\": \"4.6.0\", \"@hono/zod-openapi\": \"0.16.0\" } }\n",
        ),
        (
            "src/auth.ts",
            "import type { Context, Next } from \"hono\";\nexport async function requireAuth(c: Context, next: Next) {\n  if (!c.req.header(\"authorization\")) {\n    return c.json({ error: \"unauthenticated\" }, 401);\n  }\n  await next();\n}\n",
        ),
        (
            "src/server.ts",
            "import { OpenAPIHono, createRoute } from \"@hono/zod-openapi\";\nimport { requireAuth } from \"./auth\";\nconst h = (c: any) => c.json([]);\nconst a = new OpenAPIHono();\na.use(\"/a/*\", requireAuth);\na.openapi(createRoute({ method: \"get\", path: \"/a/users\" }), h);\na.openapi(createRoute({ method: \"get\", path: \"/open/users\" }), h);\nfunction setup(x: OpenAPIHono) {\n  x.use(requireAuth);\n}\nconst b = new OpenAPIHono();\nsetup(b);\nb.openapi(createRoute({ method: \"get\", path: \"/b/users\" }), h);\nconst d = new OpenAPIHono().basePath(\"/d\");\nd.use(\"/in/*\", requireAuth);\nd.openapi(createRoute({ method: \"get\", path: \"/in/users\" }), h);\nd.openapi(createRoute({ method: \"get\", path: \"/out/users\" }), h);\nconst table: any = { auth: requireAuth };\nconst g = new OpenAPIHono();\ng.use(table[process.env.K!]);\ng.openapi(createRoute({ method: \"get\", path: \"/g/users\" }), h);\nexport default a;\n",
        ),
    ]
    .iter()
    .map(|(p, b)| ((*p).to_string(), (*b).to_string()))
    .collect();
    let dir = write(&files);
    let r = read(dir.path(), "openapi");
    assert_eq!(r.assignment("a path", "/a/users"), "known");
    assert_eq!(r.assignment("a path", "/open/users"), "none");
    assert_eq!(r.assignment("passed", "/b/users"), "known");
    assert_eq!(r.assignment("under a base", "/in/users"), "known");
    assert_eq!(r.assignment("under a base", "/out/users"), "none");
    assert_eq!(r.assignment("no name", "/g/users"), "unknown");
}

/// A Fastify route declared in full (`f.route({ method, url, handler })`) is read
/// with what the instance was given for a path that takes it, as one declared in
/// short (`f.get(...)`).
#[test]
fn a_fastify_route_declared_in_full_is_read_with_what_was_given_for_its_path() {
    let files: Files = [
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"fastify\": \"4.28.0\" } }\n",
        ),
        (
            "src/auth.ts",
            "export function requireUser(req: any, res: any, next: any) {\n  if (!req.headers.authorization) {\n    res.status(401).json({ error: \"unauthenticated\" });\n    return;\n  }\n  next();\n}\n",
        ),
        (
            "src/server.ts",
            "import Fastify from \"fastify\";\nimport { requireUser } from \"./auth\";\nconst f = Fastify();\nf.use(\"/fapi\", requireUser);\nf.route({ method: \"GET\", url: \"/fapi/full\", handler: async () => [] });\nf.get(\"/fapi/short\", async () => []);\nf.route({ method: \"GET\", url: \"/fopen/full\", handler: async () => [] });\n",
        ),
    ]
    .iter()
    .map(|(p, b)| ((*p).to_string(), (*b).to_string()))
    .collect();
    let dir = write(&files);
    let r = read(dir.path(), "fastify in full");
    assert_eq!(r.assignment("short", "/fapi/short"), "known");
    assert_eq!(r.assignment("in full", "/fapi/full"), "known");
    assert_eq!(r.assignment("in full, set apart", "/fopen/full"), "none");
}

// ---------------------------------------------------------------------------
// Round 11: what decides authentication outside the route's own guard positions.

const R11_NEXT_PACKAGE: &str = "{ \"name\": \"web\", \"dependencies\": { \"next\": \"14.2.0\", \"iron-session\": \"8.0.0\", \"@kinde-oss/kinde-auth-nextjs\": \"2.3.0\" } }\n";
const R11_TSCONFIG: &str =
    "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }\n";
const R11_ROUTE: &str = "import { NextResponse } from \"next/server\";\nexport async function GET() {\n  return NextResponse.json([]);\n}\n";

/// A Next.js application with these files and the package beside them.
fn r11_next(files: &[(&str, String)]) -> Files {
    let mut out = Files::new();
    out.insert("package.json".into(), R11_NEXT_PACKAGE.into());
    out.insert("tsconfig.json".into(), R11_TSCONFIG.into());
    for (path, body) in files {
        out.insert((*path).to_string(), body.clone());
    }
    out
}

/// The cells of a block: (what, the fixture, route, what the route must read).
type R11Cell = (String, Files, &'static str, &'static [&'static str]);

fn r11_check(cells: Vec<R11Cell>) -> (usize, Vec<String>) {
    let mut wrong = Vec::new();
    let n = cells.len();
    for (what, files, route, want) in cells {
        let dir = write(&files);
        // The middleware's own row of the inventory is no route: the two readings
        // are held to one another for the routes ([`read`]).
        if files.contains_key("middleware.ts") {
            let practice = authn(dir.path());
            let inv: BTreeMap<String, (Vec<String>, Vec<String>)> = inventory(dir.path())
                .into_iter()
                .filter(|(k, _)| !k.trim().is_empty())
                .collect();
            assert_eq!(
                practice.keys().collect::<Vec<_>>(),
                inv.keys().collect::<Vec<_>>(),
                "{what}: the two list the same routes"
            );
            let got = practice
                .get(&format!("GET {route}"))
                .map_or("absent", |(a, _)| a.as_str())
                .to_string();
            let (guards, opaque) = &inv[&format!("GET {route}")];
            let state = match (guards.is_empty(), opaque.is_empty()) {
                (false, _) => "known",
                (true, false) => "unknown",
                (true, true) => "none",
            };
            if state != got {
                wrong.push(format!(
                    "{what} {route}: the inventory says {state}, the practice map {got}"
                ));
            }
            if !want.contains(&got.as_str()) {
                wrong.push(format!("{what} {route}: reads {got}, expected {want:?}"));
            }
            continue;
        }
        let r = read(dir.path(), &what);
        // Known by what turns no one away (a session read with no check) is no
        // guard, as [`read`] holds it.
        let (a, key) = &r.authn[&format!("GET {route}")];
        let enforced = key.split('+').any(|piece| {
            !["identifies:", "opens:", "service_auth:"]
                .iter()
                .any(|m| piece.starts_with(m))
        });
        let got = if (a == "known" && !enforced) || a == "identified" {
            "none".to_string()
        } else {
            a.clone()
        };
        if !want.contains(&got.as_str()) {
            wrong.push(format!("{what} {route}: reads {got}, expected {want:?}"));
        }
    }
    (n, wrong)
}

/// [STRICT] A NestJS `APP_GUARD` whose guard is not a class named where it is
/// provided (`useFactory`, `useValue`, `useClass` chosen by a condition or the
/// environment, a provider held in a variable or spread in, `providers` built
/// elsewhere): the guard that runs is not read, so every route of the application
/// is unknown, never `known` and never `none`. A class named there is read as it
/// always was (the guard where it refuses, nothing where it turns no one away).
#[test]
fn nest_an_app_guard_not_named_where_it_is_provided_is_not_read() {
    let head = "import { Module } from \"@nestjs/common\";\nimport { APP_GUARD, Reflector } from \"@nestjs/core\";\nimport { ItemsController } from \"./items.controller\";\nimport { IfGuard, OpenGuard } from \"./guards\";\n";
    let cells: &[(&str, &str, &[&str])] = &[
        (
            "useFactory",
            "@Module({ controllers: [ItemsController], providers: [{ provide: APP_GUARD, useFactory: (r: Reflector) => new IfGuard(), inject: [Reflector] }] })\nexport class AppModule {}\n",
            &["unknown"],
        ),
        (
            "useFactory on the environment",
            "@Module({ controllers: [ItemsController], providers: [{ provide: APP_GUARD, useFactory: () => (process.env.AUTH_OFF ? new OpenGuard() : new IfGuard()) }] })\nexport class AppModule {}\n",
            &["unknown"],
        ),
        (
            "useClass by a condition",
            "@Module({ controllers: [ItemsController], providers: [{ provide: APP_GUARD, useClass: process.env.AUTH_OFF ? OpenGuard : IfGuard }] })\nexport class AppModule {}\n",
            &["unknown"],
        ),
        (
            "useExisting by a condition",
            "@Module({ controllers: [ItemsController], providers: [IfGuard, OpenGuard, { provide: APP_GUARD, useExisting: process.env.NODE_ENV === \"test\" ? OpenGuard : IfGuard }] })\nexport class AppModule {}\n",
            &["unknown"],
        ),
        (
            "useValue",
            "@Module({ controllers: [ItemsController], providers: [{ provide: APP_GUARD, useValue: new IfGuard() }] })\nexport class AppModule {}\n",
            &["unknown"],
        ),
        (
            "a provider in a variable",
            "const guard = { provide: APP_GUARD, useClass: IfGuard };\n@Module({ controllers: [ItemsController], providers: [guard] })\nexport class AppModule {}\n",
            &["unknown"],
        ),
        (
            "providers spread in",
            "const shared = [{ provide: APP_GUARD, useClass: IfGuard }];\n@Module({ controllers: [ItemsController], providers: [...shared] })\nexport class AppModule {}\n",
            &["unknown"],
        ),
        (
            "providers built elsewhere",
            "const providers = [{ provide: APP_GUARD, useClass: IfGuard }];\n@Module({ controllers: [ItemsController], providers })\nexport class AppModule {}\n",
            &["unknown"],
        ),
        (
            "useClass named",
            "@Module({ controllers: [ItemsController], providers: [{ provide: APP_GUARD, useClass: IfGuard }] })\nexport class AppModule {}\n",
            &["known"],
        ),
        (
            "useClass named, with services",
            "@Module({ controllers: [ItemsController], providers: [Reflector, { provide: APP_GUARD, useClass: IfGuard }] })\nexport class AppModule {}\n",
            &["known"],
        ),
        (
            "useClass named, turning no one away",
            "@Module({ controllers: [ItemsController], providers: [{ provide: APP_GUARD, useClass: OpenGuard }] })\nexport class AppModule {}\n",
            &["none"],
        ),
    ];
    let mut wrong = Vec::new();
    for (what, module, want) in cells {
        let files = nest_global(&format!("{head}{module}"), &nest_bootstrap(""));
        let dir = write(&files);
        let r = read(dir.path(), what);
        let got = r.assignment(what, "/items");
        if !want.contains(&got) {
            wrong.push(format!("{what}: reads {got}, expected {want:?}"));
        }
    }
    assert!(
        wrong.is_empty(),
        "{} of {} wrong:\n{}",
        wrong.len(),
        cells.len(),
        wrong.join("\n")
    );
}

/// [STRICT] A Next.js `middleware.ts` whose refusals stand after a return that lets
/// some requests through (a list of open paths from the environment, computed at
/// start or written out; a `NextResponse.rewrite(...)` returned before the session
/// is tested): which requests pass without the test is not read, so every route
/// the matcher covers is unknown, the paths of the list included; never known. As
/// a matrix: how the list is built x how it is tested, and the rewrite. One that
/// tests every request is the guard of the routes it covers.
#[test]
fn next_a_middleware_that_lets_some_requests_pass_before_it_refuses_is_not_proven() {
    let lists = [
        (
            "from the environment",
            "const OPEN = (process.env.OPEN_PATHS ?? \"\").split(\",\");",
        ),
        (
            "a Set from the environment",
            "const OPEN = new Set(process.env.OPEN_PATHS?.split(\",\") ?? []);",
        ),
        (
            "computed at start",
            "const OPEN = [\"/api/health\", ...(process.env.EXTRA ?? \"\").split(\",\")];",
        ),
        ("written out", "const OPEN = [\"/api/health\"];"),
    ];
    let tests = [
        ("includes", "OPEN.includes(req.nextUrl.pathname)"),
        ("has", "OPEN.has(req.nextUrl.pathname)"),
        (
            "some startsWith",
            "[...OPEN].some((p) => req.nextUrl.pathname.startsWith(p))",
        ),
    ];
    let refuse = "  if (!req.cookies.get(\"session\")) return NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });\n  return NextResponse.next();\n}\nexport const config = { matcher: [\"/api/:path*\"] };\n";
    let routes = |mw: String| {
        r11_next(&[
            ("middleware.ts", mw),
            ("app/api/items/route.ts", R11_ROUTE.into()),
            ("app/api/health/route.ts", R11_ROUTE.into()),
            ("app/api/admin/users/route.ts", R11_ROUTE.into()),
        ])
    };
    let mut cells: Vec<R11Cell> = Vec::new();
    for (list, decl) in lists {
        for (test, cond) in tests {
            // A list written out is tested by `has` only as a Set.
            let decl = if test == "has" && !decl.contains("Set") {
                decl.replace("const OPEN = ", "const OPEN = new Set(")
                    .replace(';', ");")
            } else {
                decl.to_string()
            };
            let mw = format!(
                "import {{ NextResponse, type NextRequest }} from \"next/server\";\n{decl}\nexport function middleware(req: NextRequest) {{\n  if ({cond}) return NextResponse.next();\n{refuse}"
            );
            for route in ["/api/items", "/api/health"] {
                cells.push((
                    format!("{list}, {test}"),
                    routes(mw.clone()),
                    route,
                    &["unknown"],
                ));
            }
        }
    }
    let rewrite = format!(
        "import {{ NextResponse, type NextRequest }} from \"next/server\";\nexport function middleware(req: NextRequest) {{\n  if (req.nextUrl.pathname.startsWith(\"/api/legacy\")) {{\n    return NextResponse.rewrite(new URL(req.nextUrl.pathname.replace(\"/api/legacy\", \"/api/admin\"), req.url));\n  }}\n{refuse}"
    );
    for route in ["/api/admin/users", "/api/items"] {
        cells.push((
            "a rewrite before the test".into(),
            routes(rewrite.clone()),
            route,
            &["unknown"],
        ));
    }
    let every = format!(
        "import {{ NextResponse, type NextRequest }} from \"next/server\";\nexport function middleware(req: NextRequest) {{\n{refuse}"
    );
    for route in ["/api/items", "/api/admin/users"] {
        cells.push((
            "every request tested".into(),
            routes(every.clone()),
            route,
            &["known"],
        ));
    }
    let (n, wrong) = r11_check(cells);
    assert!(
        wrong.is_empty(),
        "{} of {n} wrong:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}

/// [STRICT] A function every value of which is a 401 response built as a value (a
/// refusal builder: `const unauthenticated = () => NextResponse.json({ error }, {
/// status: 401 })`) is read as the response it builds wherever a handler returns
/// its call: `if (!member) return unauthenticated()` is the route's check, as `if
/// (!member) return NextResponse.json(..., { status: 401 })` is. As a matrix: how
/// the builder is written (an arrow, a function, in the route's file or imported,
/// by `new Response` or `NextResponse.json`) x where its call is returned (a route
/// handler, the middleware, a block). A builder of another status refuses no
/// signed-out caller.
#[test]
fn a_function_that_builds_the_401_is_a_refusal_wherever_it_is_returned() {
    let builders = [
        (
            "an arrow",
            "export const unauthenticated = () => NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });\n",
        ),
        (
            "a function",
            "export function unauthenticated() {\n  return NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });\n}\n",
        ),
        (
            "an arrow with a body",
            "export const unauthenticated = (why = \"unauthenticated\") => {\n  return new Response(JSON.stringify({ error: why }), { status: 401 });\n};\n",
        ),
        (
            "by Response.json",
            "export const unauthenticated = () => Response.json({ error: \"unauthenticated\" }, { status: 401 });\n",
        ),
    ];
    let head = "import { NextResponse, type NextRequest } from \"next/server\";\n";
    let mut cells: Vec<R11Cell> = Vec::new();
    for (how, builder) in builders {
        for imported in [false, true] {
            let (lib, import) = if imported {
                (
                    format!("{head}{builder}"),
                    "import { unauthenticated } from \"@/lib/http\";\n".to_string(),
                )
            } else {
                (String::new(), builder.to_string())
            };
            let member = "async function member(req: NextRequest) {\n  const token = req.cookies.get(\"session\")?.value;\n  return token ? { id: token } : null;\n}\n";
            for (place, returned) in [
                ("returned", "  if (!m) return unauthenticated();\n"),
                (
                    "returned from a block",
                    "  if (!m) {\n    return unauthenticated();\n  }\n",
                ),
            ] {
                let route = format!(
                    "{head}{import}{member}export async function GET(req: NextRequest) {{\n  const m = await member(req);\n{returned}  return NextResponse.json([]);\n}}\n"
                );
                let mut files = vec![("app/api/items/route.ts", route)];
                if imported {
                    files.push(("lib/http.ts", lib.clone()));
                }
                cells.push((
                    format!(
                        "{how}, {}, {place}",
                        if imported { "imported" } else { "local" }
                    ),
                    r11_next(&files),
                    "/api/items",
                    &["known"],
                ));
            }
            let mw = format!(
                "{head}{import}export function middleware(req: NextRequest) {{\n  if (!req.cookies.get(\"session\")) return unauthenticated();\n  return NextResponse.next();\n}}\nexport const config = {{ matcher: [\"/api/:path*\"] }};\n"
            );
            let mut files = vec![
                ("middleware.ts", mw),
                ("app/api/items/route.ts", R11_ROUTE.to_string()),
            ];
            if imported {
                files.push(("lib/http.ts", lib.clone()));
            }
            cells.push((
                format!(
                    "{how}, {}, in the middleware",
                    if imported { "imported" } else { "local" }
                ),
                r11_next(&files),
                "/api/items",
                &["known"],
            ));
        }
    }
    // Another status refuses no one who is not signed in.
    let route = format!(
        "{head}const unauthenticated = () => NextResponse.json({{ error: \"x\" }}, {{ status: 200 }});\nexport async function GET(req: NextRequest) {{\n  if (!req.cookies.get(\"session\")) return unauthenticated();\n  return NextResponse.json([]);\n}}\n"
    );
    cells.push((
        "a builder of 200".into(),
        r11_next(&[("app/api/items/route.ts", route)]),
        "/api/items",
        &["none"],
    ));
    let (n, wrong) = r11_check(cells);
    assert!(
        wrong.is_empty(),
        "{} of {n} wrong:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}

/// [STRICT] A test of a value a library always hands back refuses no one: an
/// iron-session `getIronSession(...)` result is an object whatever the cookie (`if
/// (!session)` is never true), and a Promise is always true (`if
/// (!isAuthenticated())` of Kinde, or of an `async` function of the file, not
/// awaited, is never true). No guard; never known. A test of a member of the
/// session (`!session.user`), and the Promise awaited, are the guard.
#[test]
fn a_test_that_is_never_true_is_no_guard() {
    let iron = |cond: &str| {
        format!(
            "import {{ NextResponse }} from \"next/server\";\nimport {{ cookies }} from \"next/headers\";\nimport {{ getIronSession }} from \"iron-session\";\ntype S = {{ user?: {{ id: string }} }};\nexport async function GET() {{\n  const session = await getIronSession<S>(cookies(), {{ password: process.env.SECRET!, cookieName: \"s\" }});\n  if ({cond}) return NextResponse.json({{ error: \"unauthenticated\" }}, {{ status: 401 }});\n  return NextResponse.json([]);\n}}\n"
        )
    };
    let kinde = |cond: &str| {
        format!(
            "import {{ NextResponse }} from \"next/server\";\nimport {{ getKindeServerSession }} from \"@kinde-oss/kinde-auth-nextjs/server\";\nexport async function GET() {{\n  const {{ isAuthenticated }} = getKindeServerSession();\n  if ({cond}) return NextResponse.json({{ error: \"unauthenticated\" }}, {{ status: 401 }});\n  return NextResponse.json([]);\n}}\n"
        )
    };
    let local = |decl: &str, cond: &str| {
        format!(
            "import {{ NextResponse, type NextRequest }} from \"next/server\";\n{decl}\nexport async function GET(req: NextRequest) {{\n  if ({cond}) return NextResponse.json({{ error: \"unauthenticated\" }}, {{ status: 401 }});\n  return NextResponse.json([]);\n}}\n"
        )
    };
    let decl_async = "async function isSignedIn(req: NextRequest) {\n  return Boolean(req.cookies.get(\"session\"));\n}";
    let decl_typed = "const isSignedIn = (req: NextRequest): Promise<boolean> => Promise.resolve(Boolean(req.cookies.get(\"session\")));";
    let cells: Vec<(&str, String, &[&str])> = vec![
        (
            "iron-session, the session itself",
            iron("!session"),
            &["none"],
        ),
        ("iron-session, a member", iron("!session.user"), &["known"]),
        (
            "Kinde, not awaited",
            kinde("!isAuthenticated()"),
            &["none", "unknown"],
        ),
        (
            "Kinde, awaited",
            kinde("!(await isAuthenticated())"),
            &["known"],
        ),
        (
            "an async function, not awaited",
            local(decl_async, "!isSignedIn(req)"),
            &["none"],
        ),
        (
            "an async function, awaited",
            local(decl_async, "!(await isSignedIn(req))"),
            &["known"],
        ),
        (
            "a function typed Promise, not awaited",
            local(decl_typed, "!isSignedIn(req)"),
            &["none"],
        ),
        (
            "a function typed Promise, awaited",
            local(decl_typed, "!(await isSignedIn(req))"),
            &["known"],
        ),
    ];
    let cells: Vec<R11Cell> = cells
        .into_iter()
        .map(|(what, route, want)| {
            (
                what.to_string(),
                r11_next(&[("app/api/items/route.ts", route)]),
                "/api/items",
                want,
            )
        })
        .collect();
    let (n, wrong) = r11_check(cells);
    assert!(
        wrong.is_empty(),
        "{} of {n} wrong:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}

/// A route handler re-exported by a file of another path is the route of that
/// path: covered by the middleware where its own path is, not where the file it
/// re-exports from is.
#[test]
fn next_a_reexported_handler_is_covered_by_the_path_it_answers_at() {
    let mw = "import { NextResponse, type NextRequest } from \"next/server\";\nexport function middleware(req: NextRequest) {\n  if (!req.cookies.get(\"session\")) return NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });\n  return NextResponse.next();\n}\nexport const config = { matcher: [\"/api/:path*\"] };\n";
    let mut cells: Vec<R11Cell> = Vec::new();
    for (how, reexport) in [
        (
            "export { GET } from",
            "export { GET } from \"../../api/admin/users/route\";\n",
        ),
        (
            "through the alias",
            "export { GET } from \"@/app/api/admin/users/route\";\n",
        ),
        (
            "imported and bound",
            "import { GET as handler } from \"../../api/admin/users/route\";\nexport const GET = handler;\n",
        ),
    ] {
        let files = r11_next(&[
            ("middleware.ts", mw.into()),
            ("app/api/admin/users/route.ts", R11_ROUTE.into()),
            ("app/public/users/route.ts", reexport.into()),
        ]);
        cells.push((
            format!("{how}, outside the matcher"),
            files.clone(),
            "/public/users",
            &["none"],
        ));
        cells.push((
            format!("{how}, the original"),
            files,
            "/api/admin/users",
            &["known"],
        ));
    }
    let (n, wrong) = r11_check(cells);
    assert!(
        wrong.is_empty(),
        "{} of {n} wrong:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}

/// Both readings of every route of a fixture, as one state each: the practice map's
/// assignment (known by what turns no one away counts as none) and the inventory's
/// (`known` with a guard, `unknown` with only what is unread, `none` with nothing).
fn both_states(root: &Path) -> BTreeMap<String, (String, String)> {
    let practice = authn(root);
    inventory(root)
        .into_iter()
        .filter(|(k, _)| !k.trim().is_empty())
        .map(|(route, (guards, opaque))| {
            let inv = match (guards.is_empty(), opaque.is_empty()) {
                (false, _) => "known",
                (true, false) => "unknown",
                (true, true) => "none",
            };
            let map = practice
                .get(&route)
                .map_or("absent".to_string(), |(a, key)| {
                    let enforced = key.split('+').any(|piece| {
                        !["identifies:", "opens:", "service_auth:"]
                            .iter()
                            .any(|m| piece.starts_with(m))
                    });
                    if a == "known" && !enforced {
                        "none".to_string()
                    } else {
                        a.clone()
                    }
                });
            (route, (map, inv.to_string()))
        })
        .collect()
}

/// [STRICT] A response built as a value refuses no one until it is returned, and a
/// refusal builder checks no one: it refuses only as the exit of a caller's check.
/// As a matrix: how the builder is written (an arrow, a function, an arrow with a
/// body by `new Response`, by `Response.json`) x where it is defined (the route's
/// file, imported) x how its call is used (returned under a check: the guard;
/// called as a statement in the branch, as the branch itself, in a short circuit;
/// bound to a name and dropped; returned on some paths of a condition on data, in
/// one arm of a conditional on data: no guard) x where (a route handler, the
/// middleware, for the uses a middleware can make). And the response written in
/// place as a statement of its own (`NextResponse.json(...)`, `Response.json(...)`,
/// `new NextResponse(...)`), in both places. `drift security` says of every route
/// what the practice map says.
#[test]
fn a_response_built_as_a_value_refuses_only_where_it_is_returned_under_a_check() {
    let builders = [
        (
            "an arrow",
            "export const unauthenticated = () => NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });\n",
        ),
        (
            "a function",
            "export function unauthenticated() {\n  return NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });\n}\n",
        ),
        (
            "an arrow with a body",
            "export const unauthenticated = (why = \"unauthenticated\") => {\n  return new Response(JSON.stringify({ error: why }), { status: 401 });\n};\n",
        ),
        (
            "by Response.json",
            "export const unauthenticated = () => Response.json({ error: \"unauthenticated\" }, { status: 401 });\n",
        ),
    ];
    let head = "import { NextResponse, type NextRequest } from \"next/server\";\nimport { load } from \"@/lib/data\";\n";
    let data = "export async function load() {\n  return [1, 2, 3];\n}\n";
    // (name, the body of `GET` before its last `return`, the route's last line,
    // what it reads).
    let uses: &[(&str, &str, &str, &str)] = &[
        (
            "returned under a check",
            "  if (!req.cookies.get(\"session\")) return unauthenticated();\n",
            "  return NextResponse.json([]);\n",
            "known",
        ),
        (
            "called as a statement in the branch",
            "  if (!req.cookies.get(\"session\")) {\n    unauthenticated();\n  }\n",
            "  return NextResponse.json([]);\n",
            "none",
        ),
        (
            "called as the branch",
            "  if (!req.cookies.get(\"session\")) unauthenticated();\n",
            "  return NextResponse.json([]);\n",
            "none",
        ),
        (
            "called in a short circuit",
            "  !req.cookies.get(\"session\") && unauthenticated();\n",
            "  return NextResponse.json([]);\n",
            "none",
        ),
        (
            "bound and dropped",
            "  const denied = unauthenticated();\n  console.log(denied.status);\n",
            "  return NextResponse.json([]);\n",
            "none",
        ),
        (
            "returned on some paths of a condition on data",
            "  const rows = await load();\n  if (rows.length) {\n    return NextResponse.json(rows);\n  }\n",
            "  return unauthenticated();\n",
            "none",
        ),
        (
            "returned in one arm of a conditional on data",
            "  const rows = await load();\n",
            "  return rows.length > 100 ? unauthenticated() : NextResponse.json(rows);\n",
            "none",
        ),
    ];
    // The uses a middleware makes, with what follows (`NextResponse.next()`).
    let mw_uses: &[(&str, &str, &str)] = &[
        (
            "returned under a check",
            "  if (!req.cookies.get(\"session\")) return unauthenticated();\n",
            "known",
        ),
        (
            "called as a statement in the branch",
            "  if (!req.cookies.get(\"session\")) {\n    unauthenticated();\n  }\n",
            "none",
        ),
        (
            "called as the branch",
            "  if (!req.cookies.get(\"session\")) unauthenticated();\n",
            "none",
        ),
        (
            "bound and dropped",
            "  const denied = unauthenticated();\n  console.log(denied.status);\n",
            "none",
        ),
    ];
    let mut cells = 0;
    let mut wrong = Vec::new();
    let mut judge = |what: String, files: Files, want: &[(String, &str, &str)]| {
        let dir = write(&files);
        let states = both_states(dir.path());
        for (route, name, expected) in want {
            cells += 1;
            let key = format!("GET {route}");
            let (map, inv) = states
                .get(&key)
                .cloned()
                .unwrap_or_else(|| ("absent".into(), "absent".into()));
            if map != inv {
                wrong.push(format!(
                    "{what}{name} {route}: the practice map says {map}, the inventory {inv}"
                ));
            }
            if map != *expected {
                wrong.push(format!(
                    "{what}{name} {route}: reads {map}, expected {expected}"
                ));
            }
        }
    };
    for (how, builder) in builders {
        for imported in [false, true] {
            let at = if imported { "imported" } else { "local" };
            let import = if imported {
                "import { unauthenticated } from \"@/lib/http\";\n".to_string()
            } else {
                builder.to_string()
            };
            let lib = format!("import {{ NextResponse }} from \"next/server\";\n{builder}");
            // A route handler: one route per use.
            let mut files = vec![("lib/data.ts".to_string(), data.to_string())];
            if imported {
                files.push(("lib/http.ts".into(), lib.clone()));
            }
            let mut want = Vec::new();
            for (i, (name, body, last, reads)) in uses.iter().enumerate() {
                files.push((
                    format!("app/api/r{i}/route.ts"),
                    format!(
                        "{head}{import}export async function GET(req: NextRequest) {{\n{body}{last}}}\n"
                    ),
                ));
                want.push((format!("/api/r{i}"), *name, *reads));
            }
            let files: Vec<(&str, String)> =
                files.iter().map(|(p, b)| (p.as_str(), b.clone())).collect();
            judge(
                format!("{how}, {at}, in a route handler: "),
                r11_next(&files),
                &want,
            );
            // The middleware.
            for (name, body, reads) in mw_uses {
                let mw = format!(
                    "{head}{import}export function middleware(req: NextRequest) {{\n{body}  return NextResponse.next();\n}}\nexport const config = {{ matcher: [\"/api/:path*\"] }};\n"
                );
                let mut files = vec![
                    ("middleware.ts", mw),
                    ("app/api/items/route.ts", R11_ROUTE.to_string()),
                    ("lib/data.ts", data.to_string()),
                ];
                if imported {
                    files.push(("lib/http.ts", lib.clone()));
                }
                judge(
                    format!("{how}, {at}, in the middleware: "),
                    r11_next(&files),
                    &[("/api/items".to_string(), name, reads)],
                );
            }
        }
    }
    // The response written in place as a statement of its own.
    for (how, stmt) in [
        (
            "NextResponse.json",
            "NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });",
        ),
        (
            "Response.json",
            "Response.json({ error: \"unauthenticated\" }, { status: 401 });",
        ),
        (
            "new NextResponse",
            "new NextResponse(null, { status: 401 });",
        ),
    ] {
        let route = format!(
            "{head}export async function GET(req: NextRequest) {{\n  if (!req.cookies.get(\"session\")) {{\n    {stmt}\n  }}\n  return NextResponse.json([]);\n}}\n"
        );
        judge(
            format!("{how} as a statement, in a route handler"),
            r11_next(&[
                ("app/api/items/route.ts", route),
                ("lib/data.ts", data.to_string()),
            ]),
            &[("/api/items".to_string(), "", "none")],
        );
        let mw = format!(
            "{head}export function middleware(req: NextRequest) {{\n  if (!req.cookies.get(\"session\")) {{\n    {stmt}\n  }}\n  return NextResponse.next();\n}}\nexport const config = {{ matcher: [\"/api/:path*\"] }};\n"
        );
        judge(
            format!("{how} as a statement, in the middleware"),
            r11_next(&[
                ("middleware.ts", mw),
                ("app/api/items/route.ts", R11_ROUTE.to_string()),
                ("lib/data.ts", data.to_string()),
            ]),
            &[("/api/items".to_string(), "", "none")],
        );
    }
    assert!(
        wrong.is_empty(),
        "{} wrong of {cells} cells:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}

/// [STRICT] A provider listed among a `@Module`'s providers that is no object
/// written in place is read for what it is bound to, never for how it is named, and
/// whatever the module file imports: a class (of this file, of another file of the
/// repository, or of Nest's own packages) is no guard's provider; anything else (a
/// binding of this file or of another, under any name: `guard`, `AUTH_GUARD`,
/// `GlobalAuthGuard`; the call of a function; a member) may be an `APP_GUARD`
/// provider, and every route of the application is unknown. As a matrix: how the
/// provider is named x where it is bound x with the module importing `APP_GUARD` or
/// not; and the classes, with an `APP_GUARD` named beside them or none.
#[test]
fn nest_a_provider_bound_to_a_name_or_built_by_a_call_is_never_read_by_its_name() {
    let mut wrong = Vec::new();
    let mut cells = 0;
    let mut judge = |what: String, files: Files, want: &str| {
        cells += 1;
        let dir = write(&files);
        let states = both_states(dir.path());
        let (map, inv) = states
            .get("GET /items")
            .cloned()
            .unwrap_or_else(|| ("absent".into(), "absent".into()));
        if map != inv {
            wrong.push(format!(
                "{what}: the practice map says {map}, the inventory {inv}"
            ));
        }
        if map != want {
            wrong.push(format!("{what}: reads {map}, expected {want}"));
        }
    };
    let provider = "{ provide: APP_GUARD, useClass: IfGuard }";
    for name in ["guard", "AUTH_GUARD", "GlobalAuthGuard"] {
        for imports_app_guard in [true, false] {
            let core = if imports_app_guard {
                "import { APP_GUARD } from \"@nestjs/core\";\n"
            } else {
                ""
            };
            // Bound in the module's own file (it needs `APP_GUARD` there).
            if imports_app_guard {
                for kw in ["const", "let"] {
                    let module = format!(
                        "import {{ Module }} from \"@nestjs/common\";\n{core}import {{ ItemsController }} from \"./items.controller\";\nimport {{ IfGuard }} from \"./guards\";\n{kw} {name} = {provider};\n@Module({{ controllers: [ItemsController], providers: [{name}] }})\nexport class AppModule {{}}\n"
                    );
                    judge(
                        format!("`{kw} {name}` in the module's file"),
                        nest_global(&module, &nest_bootstrap("")),
                        "unknown",
                    );
                }
            }
            // Bound in another file, as an object, by a function, under a member.
            for (how, other, element) in [
                (
                    "an object of another file",
                    format!("export const {name} = {provider};\n"),
                    name.to_string(),
                ),
                (
                    "a function of another file, called",
                    format!("export function {name}() {{\n  return {provider};\n}}\n"),
                    format!("{name}()"),
                ),
                (
                    "a member of an object of another file",
                    format!("export const {name} = {{ auth: {provider} }};\n"),
                    format!("{name}.auth"),
                ),
            ] {
                let module = format!(
                    "import {{ Module }} from \"@nestjs/common\";\n{core}import {{ ItemsController }} from \"./items.controller\";\nimport {{ {name} }} from \"./auth.providers\";\n@Module({{ controllers: [ItemsController], providers: [{element}] }})\nexport class AppModule {{}}\n"
                );
                let mut files = nest_global(&module, &nest_bootstrap(""));
                files.insert(
                    "src/auth.providers.ts".into(),
                    format!("import {{ APP_GUARD }} from \"@nestjs/core\";\nimport {{ IfGuard }} from \"./guards\";\n{other}"),
                );
                judge(
                    format!(
                        "{how} named `{name}`, the module {} APP_GUARD",
                        if imports_app_guard {
                            "importing"
                        } else {
                            "not importing"
                        }
                    ),
                    files,
                    "unknown",
                );
            }
            // Re-exported through a barrel.
            let module = format!(
                "import {{ Module }} from \"@nestjs/common\";\n{core}import {{ ItemsController }} from \"./items.controller\";\nimport {{ {name} }} from \"./providers\";\n@Module({{ controllers: [ItemsController], providers: [{name}] }})\nexport class AppModule {{}}\n"
            );
            let mut files = nest_global(&module, &nest_bootstrap(""));
            files.insert(
                "src/auth.providers.ts".into(),
                format!("import {{ APP_GUARD }} from \"@nestjs/core\";\nimport {{ IfGuard }} from \"./guards\";\nexport const {name} = {provider};\n"),
            );
            files.insert(
                "src/providers/index.ts".into(),
                format!("export {{ {name} }} from \"../auth.providers\";\n"),
            );
            judge(
                format!(
                    "re-exported `{name}`, the module {} APP_GUARD",
                    if imports_app_guard {
                        "importing"
                    } else {
                        "not importing"
                    }
                ),
                files,
                "unknown",
            );
        }
    }
    // Classes are no guard's provider: beside a named `APP_GUARD` the route is the
    // guard's; alone, it has none.
    let service = "import { Injectable } from \"@nestjs/common\";\n@Injectable()\nexport class ItemsService {}\n";
    for (how, import, element, local) in [
        (
            "a class of another file",
            "import { ItemsService } from \"./items.service\";\n",
            "ItemsService",
            "",
        ),
        (
            "a class re-exported by a barrel",
            "import { ItemsService } from \"./services\";\n",
            "ItemsService",
            "",
        ),
        (
            "a class of the module's file",
            "",
            "LocalService",
            "@Injectable()\nexport class LocalService {}\n",
        ),
        (
            "a lower-case class of the module's file",
            "",
            "localService",
            "@Injectable()\nclass localService {}\n",
        ),
        (
            "a class of @nestjs/core",
            "import { Reflector } from \"@nestjs/core\";\n",
            "Reflector",
            "",
        ),
        (
            "a class of @nestjs/jwt",
            "import { JwtService } from \"@nestjs/jwt\";\n",
            "JwtService",
            "",
        ),
    ] {
        for (beside, extra, want) in [
            ("beside a named APP_GUARD", format!(", {provider}"), "known"),
            ("alone", String::new(), "none"),
        ] {
            let module = format!(
                "import {{ Injectable, Module }} from \"@nestjs/common\";\nimport {{ APP_GUARD }} from \"@nestjs/core\";\nimport {{ ItemsController }} from \"./items.controller\";\nimport {{ IfGuard }} from \"./guards\";\n{import}{local}@Module({{ controllers: [ItemsController], providers: [{element}{extra}] }})\nexport class AppModule {{}}\n"
            );
            let mut files = nest_global(&module, &nest_bootstrap(""));
            files.insert("src/items.service.ts".into(), service.into());
            files.insert(
                "src/services/index.ts".into(),
                "export { ItemsService } from \"../items.service\";\n".into(),
            );
            judge(format!("{how}, {beside}"), files, want);
        }
    }
    assert!(
        wrong.is_empty(),
        "{} wrong of {cells} cells:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}

/// [STRICT] A Next.js configuration is what the module exports, however it gets
/// there: a wrapper that may add rewrites (not on the closed list of those that add
/// none) leaves every route the middleware covers unproven, whether it is applied
/// in the exported expression, to a binding exported after it (`const nextConfig =
/// withProxy({...}); module.exports = nextConfig`), by a reassignment, or in the
/// body of a function configuration; and so does a configuration imported from
/// another file. As a matrix: how the configuration is exported x with a wrapper
/// that may add rewrites (unknown), with one that adds none and with none (the
/// middleware is the guard) x as CommonJS (`next.config.js`) and as an ES module
/// (`next.config.mjs`). The two readings agree.
#[test]
fn next_a_configuration_wrapper_is_read_however_the_configuration_is_exported() {
    let route = "export async function GET() {\n  return Response.json([]);\n}\n";
    let mw = "import { NextResponse, type NextRequest } from \"next/server\";\nexport function middleware(req: NextRequest) {\n  if (!req.cookies.get(\"session\")) {\n    return new NextResponse(null, { status: 401 });\n  }\n  return NextResponse.next();\n}\nexport const config = { matcher: [\"/api/admin/:path*\"] };\n";
    // How the configuration `CONFIG` (an expression) is exported, by module kind.
    // `{E}` is the export: `module.exports =` or `export default`.
    let shapes: &[(&str, &str)] = &[
        ("in the exported expression", "{E} CONFIG;\n"),
        (
            "through a const",
            "const nextConfig = CONFIG;\n{E} nextConfig;\n",
        ),
        (
            "through a let reassigned",
            "let nextConfig = { reactStrictMode: true };\nnextConfig = CONFIG;\n{E} nextConfig;\n",
        ),
        (
            "through two bindings",
            "const base = CONFIG;\nconst nextConfig = base;\n{E} nextConfig;\n",
        ),
        ("by an arrow function", "{E} (phase) => CONFIG;\n"),
        (
            "by an arrow function with a body",
            "{E} (phase) => {\n  const c = CONFIG;\n  return c;\n};\n",
        ),
        (
            "by a function declared and exported by name",
            "function nextConfig(phase) {\n  return CONFIG;\n}\n{E} nextConfig;\n",
        ),
    ];
    // (the wrapper's import, by module kind; the configuration; what it reads).
    let wrappers: &[(&str, &str, &str, &str, &str)] = &[
        (
            "a wrapper that may add rewrites",
            "const withProxy = require(\"./proxy\");\n",
            "import withProxy from \"./proxy.js\";\n",
            "withProxy({ reactStrictMode: true })",
            "unknown",
        ),
        (
            "a wrapper that adds none",
            "const { withSentryConfig } = require(\"@sentry/nextjs\");\n",
            "import { withSentryConfig } from \"@sentry/nextjs\";\n",
            "withSentryConfig({ reactStrictMode: true }, {})",
            "known",
        ),
        ("no wrapper", "", "", "{ reactStrictMode: true }", "known"),
    ];
    let proxy = "module.exports = function withProxy(config) {\n  return { ...config, async rewrites() { return [{ source: \"/open/:path*\", destination: \"/api/admin/:path*\" }]; } };\n};\n";
    let mut wrong = Vec::new();
    let mut cells = 0;
    let mut judge = |what: String, config_file: &str, config: String, want: &str| {
        cells += 1;
        let files: Files = [
            ("package.json", "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\", \"@sentry/nextjs\": \"8.0.0\" } }\n".to_string()),
            ("middleware.ts", mw.to_string()),
            ("proxy.js", proxy.to_string()),
            ("app/api/admin/users/route.ts", route.to_string()),
            (config_file, config),
        ]
        .iter()
        .map(|(p, b)| ((*p).to_string(), b.clone()))
        .collect();
        let dir = write(&files);
        let states = both_states(dir.path());
        let (map, inv) = states
            .get("GET /api/admin/users")
            .cloned()
            .unwrap_or_else(|| ("absent".into(), "absent".into()));
        if map != inv {
            wrong.push(format!(
                "{what}: the practice map says {map}, the inventory {inv}"
            ));
        }
        if map != want {
            wrong.push(format!("{what}: reads {map}, expected {want}"));
        }
    };
    for (shape, template) in shapes {
        for (wrapper, cjs_import, esm_import, config, want) in wrappers {
            for (kind, file, import, export) in [
                (
                    "CommonJS",
                    "next.config.js",
                    *cjs_import,
                    "module.exports =",
                ),
                (
                    "ES module",
                    "next.config.mjs",
                    *esm_import,
                    "export default",
                ),
            ] {
                let body = template.replace("CONFIG", config).replace("{E}", export);
                judge(
                    format!("{shape}, {wrapper}, {kind}"),
                    file,
                    format!("{import}{body}"),
                    want,
                );
            }
        }
    }
    // A configuration imported from another file is what that file says: not read.
    for (kind, file, body) in [
        (
            "CommonJS",
            "next.config.js",
            "const base = require(\"./base.config\");\nmodule.exports = base;\n",
        ),
        (
            "ES module",
            "next.config.mjs",
            "import base from \"./base.config.mjs\";\nexport default base;\n",
        ),
    ] {
        judge(
            format!("imported, {kind}"),
            file,
            body.to_string(),
            "unknown",
        );
    }
    assert!(
        wrong.is_empty(),
        "{} wrong of {cells} cells:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}

// ---------------------------------------------------------------------------
// TypeScript lowering 74: what a branch on the caller hands back that is not read
// is unknown, never nothing and never identified.
// ---------------------------------------------------------------------------

/// What the two readings say of each route of a Next.js application, held to one
/// another (a route identified and no one turned away is "none" on both), by route:
/// `known`, `none`, `unknown`.
fn next_states(files: &[(&str, String)]) -> BTreeMap<String, String> {
    let dir = write(&r11_next(files));
    both_states(dir.path())
        .into_iter()
        .map(|(route, (map, inv))| {
            let map = if map == "identified" {
                "none".to_string()
            } else {
                map
            };
            let state = if map == inv {
                map
            } else {
                format!("{map} / {inv}")
            };
            (route.trim_start_matches("GET ").to_string(), state)
        })
        .collect()
}

/// The routes that do not read as expected, by the use that was written.
fn misread(
    states: &BTreeMap<String, String>,
    want: &[(String, &str, String)],
    accept_service: bool,
) -> Vec<String> {
    want.iter()
        .filter_map(|(route, reads, name)| {
            let got = states.get(route).map_or("absent", String::as_str);
            // (A service's secret is known on the map and no guard of a user in the
            // inventory: "none" on both once the map's key is read.)
            let ok =
                got == *reads || (accept_service && *reads == "none" && got.starts_with("none"));
            (!ok).then(|| format!("{name} {route}: reads {got}, expected {reads}"))
        })
        .collect()
}

/// [STRICT] A refusal builder's response reaches the `return` through a local, a
/// ternary, an `else` or a local assigned in the branch: not read, so the route is
/// unknown, never identified and never "no guard". The shape the lowering reads (the
/// branch returns the call itself) stays known, a response built and dropped stays
/// nothing, and a condition on data stays nothing. As a matrix: the builder (an arrow,
/// a function; of the route's file, imported) x the way its response is returned.
#[test]
fn a_refusal_builders_response_returned_in_a_shape_not_read_is_unknown() {
    let builders = [
        (
            "an arrow",
            "export const unauthorized = () => NextResponse.json({ error: \"no\" }, { status: 401 });\n",
        ),
        (
            "a function",
            "export function unauthorized() {\n  return NextResponse.json({ error: \"no\" }, { status: 401 });\n}\n",
        ),
    ];
    let head = "import { NextResponse } from \"next/server\";\nimport { getServerSession } from \"next-auth\";\n";
    // (name, the body of `GET`, what it reads)
    let uses: &[(&str, &str, &str)] = &[
        (
            "returned directly under a check",
            "  const session = await getServerSession();\n  if (!session) return unauthorized();\n  return NextResponse.json([]);\n",
            "known",
        ),
        (
            "through a local",
            "  const session = await getServerSession();\n  if (!session) {\n    const r = unauthorized();\n    return r;\n  }\n  return NextResponse.json([]);\n",
            "unknown",
        ),
        (
            "through a local of the else",
            "  const session = await getServerSession();\n  if (session) {\n    return NextResponse.json([]);\n  } else {\n    const r = unauthorized();\n    return r;\n  }\n",
            "unknown",
        ),
        // (A builder of the file is read where it is returned in the else; one of
        // another file is told by linking, which keeps the check of the `if` branch
        // only.)
        (
            "returned in the else",
            "  const session = await getServerSession();\n  if (session) {\n    return NextResponse.json([]);\n  } else {\n    return unauthorized();\n  }\n",
            "else",
        ),
        (
            "in the arm of a conditional",
            "  const session = await getServerSession();\n  return session ? NextResponse.json([]) : unauthorized();\n",
            "unknown",
        ),
        (
            "assigned in the branch and returned later",
            "  const session = await getServerSession();\n  let res: Response | null = null;\n  if (!session) res = unauthorized();\n  if (res) return res;\n  return NextResponse.json([]);\n",
            "unknown",
        ),
        (
            "returned after the work",
            "  const session = await getServerSession();\n  if (session) {\n    return NextResponse.json([]);\n  }\n  return unauthorized();\n",
            "unknown",
        ),
        (
            "bound and dropped",
            "  const session = await getServerSession();\n  if (!session) {\n    const denied = unauthorized();\n    console.log(denied.status);\n  }\n  return NextResponse.json([]);\n",
            "none",
        ),
        (
            "called as a statement in the branch",
            "  const session = await getServerSession();\n  if (!session) {\n    unauthorized();\n  }\n  return NextResponse.json([]);\n",
            "none",
        ),
        (
            "returned in an arm of a conditional on data",
            "  const rows = await load();\n  return rows.length > 100 ? unauthorized() : NextResponse.json(rows);\n",
            "none",
        ),
    ];
    let data = "export async function load() {\n  return [1, 2, 3];\n}\n";
    let mut wrong = Vec::new();
    for (how, builder) in builders {
        for imported in [false, true] {
            let at = if imported { "imported" } else { "local" };
            let import = if imported {
                "import { unauthorized } from \"@/lib/http\";\nimport { load } from \"@/lib/data\";\n".to_string()
            } else {
                format!("import {{ load }} from \"@/lib/data\";\n{builder}")
            };
            let mut files: Vec<(String, String)> = vec![("lib/data.ts".into(), data.into())];
            if imported {
                files.push((
                    "lib/http.ts".into(),
                    format!("import {{ NextResponse }} from \"next/server\";\n{builder}"),
                ));
            }
            let mut want = Vec::new();
            for (i, (name, body, reads)) in uses.iter().enumerate() {
                files.push((
                    format!("app/api/r{i}/route.ts"),
                    format!("{head}{import}export async function GET(req: Request) {{\n{body}}}\n"),
                ));
                let reads = match (*reads, imported) {
                    ("else", false) => "known",
                    ("else", true) => "unknown",
                    (r, _) => r,
                };
                want.push((format!("/api/r{i}"), reads, format!("{how}, {at}, {name}")));
            }
            let files: Vec<(&str, String)> =
                files.iter().map(|(p, b)| (p.as_str(), b.clone())).collect();
            wrong.extend(misread(&next_states(&files), &want, false));
        }
    }
    assert!(
        wrong.is_empty(),
        "{} wrong:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}

/// [STRICT] A response whose status is a name, or an options value the lowering does
/// not read, returned under a check on the caller: unknown, never identified. The
/// readable forms stay known.
#[test]
fn a_401_whose_status_is_a_name_is_unknown_under_a_check_on_the_caller() {
    let head = "import { NextResponse } from \"next/server\";\nimport { getServerSession } from \"next-auth\";\nimport { StatusCodes } from \"http-status-codes\";\nimport { fail } from \"@/lib/http\";\nconst UNAUTH = 401;\n";
    let lib = "import { NextResponse } from \"next/server\";\nexport function fail(status: number, error: string) {\n  return NextResponse.json({ error }, { status });\n}\n".to_string();
    let uses: &[(&str, &str, &str)] = &[
        (
            "a literal",
            "NextResponse.json({ e: 1 }, { status: 401 })",
            "known",
        ),
        (
            "an enum",
            "NextResponse.json({ e: 1 }, { status: StatusCodes.UNAUTHORIZED })",
            "known",
        ),
        (
            "a constant",
            "NextResponse.json({ e: 1 }, { status: UNAUTH })",
            "unknown",
        ),
        (
            "an options local",
            "NextResponse.json({ e: 1 }, init)",
            "unknown",
        ),
        (
            "a call handed a constant",
            "fail(UNAUTH, \"no\")",
            "unknown",
        ),
    ];
    let mut files: Vec<(String, String)> = vec![("lib/http.ts".into(), lib)];
    let mut want = Vec::new();
    for (i, (name, exit, reads)) in uses.iter().enumerate() {
        files.push((
            format!("app/api/r{i}/route.ts"),
            format!(
                "{head}export async function GET(req: Request) {{\n  const init = {{ status: 401 }};\n  const session = await getServerSession();\n  if (!session) return {exit};\n  return NextResponse.json([]);\n}}\n"
            ),
        ));
        want.push((format!("/api/r{i}"), *reads, (*name).to_string()));
    }
    let files: Vec<(&str, String)> = files.iter().map(|(p, b)| (p.as_str(), b.clone())).collect();
    let wrong = misread(&next_states(&files), &want, false);
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// [STRICT] "Serve when the compare matches, refuse otherwise": the refusal on the
/// fall-through of the serving branch, or in the other arm of a conditional, is not
/// read; the route is unknown, never "no guard". As a matrix: how the secret is
/// compared (an `===` on a header, `timingSafeEqual`, both after a length check) x how
/// the refusal is written. The negated form keeps the service-secret reading, a
/// compare on data stays nothing.
#[test]
fn serve_when_the_compare_matches_and_refuse_otherwise_is_unknown() {
    let head = "import { timingSafeEqual } from \"crypto\";\nconst secret = Buffer.from(process.env.CRON_SECRET ?? \"\");\n";
    let given = "  const given = Buffer.from(req.headers.get(\"authorization\") ?? \"\");\n";
    let refuse = "new Response(null, { status: 401 })";
    let ok = "Response.json({ ok: true })";
    let tests = [
        (
            "an equality",
            "req.headers.get(\"authorization\") === `Bearer ${process.env.CRON_SECRET}`",
        ),
        ("timingSafeEqual", "timingSafeEqual(given, secret)"),
        (
            "a length check and timingSafeEqual",
            "given.length === secret.length && timingSafeEqual(given, secret)",
        ),
    ];
    let mut files: Vec<(String, String)> = Vec::new();
    let mut want = Vec::new();
    for (i, (how, test)) in tests.iter().enumerate() {
        let forms = [
            (
                "refused after the branch",
                format!("  if ({test}) {{\n    return {ok};\n  }}\n  return {refuse};\n"),
                "unknown",
            ),
            // (Read as the check it is: a service's secret, known on the map and no
            // guard of a user in the inventory.)
            (
                "refused in the else",
                format!(
                    "  if ({test}) {{\n    return {ok};\n  }} else {{\n    return {refuse};\n  }}\n"
                ),
                "none",
            ),
            (
                "refused in the arm of a conditional",
                format!("  return {test} ? {ok} : {refuse};\n"),
                "unknown",
            ),
            (
                "refused in the branch when it fails",
                format!("  if (!({test})) {{\n    return {refuse};\n  }}\n  return {ok};\n"),
                "none",
            ),
        ];
        for (j, (form, body, reads)) in forms.into_iter().enumerate() {
            let route = format!("/api/c{i}x{j}");
            files.push((
                format!("app{route}/route.ts"),
                format!("{head}export async function GET(req: Request) {{\n{given}{body}}}\n"),
            ));
            want.push((route, reads, format!("{how}, {form}")));
        }
    }
    // The answer of a function of the repository is data.
    files.push((
        "lib/data.ts".into(),
        "export async function load() {\n  return [1];\n}\n".into(),
    ));
    files.push((
        "app/api/data/route.ts".into(),
        format!(
            "import {{ load }} from \"@/lib/data\";\nexport async function GET() {{\n  const rows = await load();\n  if (rows.length) {{\n    return {ok};\n  }}\n  return {refuse};\n}}\n"
        ),
    ));
    want.push((
        "/api/data".to_string(),
        "none",
        "a condition on data".to_string(),
    ));
    let files: Vec<(&str, String)> = files.iter().map(|(p, b)| (p.as_str(), b.clone())).collect();
    let wrong = misread(&next_states(&files), &want, true);
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// [STRICT] Stripe's `constructEventAsync` verifies the signature where its promise
/// is awaited or returned as it is: a call nothing awaits, or one with `.catch()` /
/// `.then()` on it, stops nothing, so the webhook is unknown, never known. The
/// synchronous `constructEvent` is a check as it was.
#[test]
fn stripe_construct_event_async_is_a_check_only_where_it_is_awaited_or_returned() {
    let head =
        "import Stripe from \"stripe\";\nconst stripe = new Stripe(process.env.STRIPE_KEY!);\n";
    let read = "  const body = await req.text();\n  const sig = req.headers.get(\"stripe-signature\") ?? \"\";\n";
    let call = "stripe.webhooks.constructEventAsync(body, sig, process.env.STRIPE_WH!)";
    let sync = "stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WH!)";
    let uses: Vec<(&str, String, &str)> = vec![
        ("sync", format!("  {sync};\n"), "none"),
        ("awaited", format!("  await {call};\n"), "none"),
        (
            "awaited and bound",
            format!("  const event = await {call};\n  void event;\n"),
            "none",
        ),
        (
            "returned",
            format!("  return {call}.then(() => Response.json({{ ok: true }}));\n"),
            "unknown",
        ),
        ("not awaited", format!("  {call};\n"), "unknown"),
        (
            "bound and not awaited",
            format!("  const pending = {call};\n  void pending;\n"),
            "unknown",
        ),
        (
            "caught",
            format!("  await {call}.catch(() => null);\n"),
            "unknown",
        ),
        (
            "then with a handler",
            format!("  await {call}.then((e) => e, () => null);\n"),
            "unknown",
        ),
    ];
    let mut files: Vec<(String, String)> = Vec::new();
    let mut want = Vec::new();
    for (i, (name, body, reads)) in uses.iter().enumerate() {
        let tail = if body.contains("return ") {
            ""
        } else {
            "  return Response.json({ ok: true });\n"
        };
        files.push((
            format!("app/api/w{i}/route.ts"),
            format!("{head}export async function POST(req: Request) {{\n{read}{body}{tail}}}\n"),
        ));
        want.push((format!("/api/w{i}"), *reads, (*name).to_string()));
    }
    let files: Vec<(&str, String)> = files.iter().map(|(p, b)| (p.as_str(), b.clone())).collect();
    let dir = write(&r11_next(&files));
    let states = both_states(dir.path());
    // A webhook's verified signature is a service's check: known on the map, no
    // guard of a user in the inventory ("none" on both once the map's key is read).
    let wrong: Vec<String> = want
        .iter()
        .filter_map(|(route, reads, name)| {
            let (map, inv) = states
                .get(&format!("POST {route}"))
                .cloned()
                .unwrap_or_else(|| ("absent".into(), "absent".into()));
            let ok = map == inv && map == *reads;
            (!ok).then(|| format!("{name} {route}: map {map}, inventory {inv}, expected {reads}"))
        })
        .collect();
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// [STRICT] A function of the repository named `unauthorized` or `forbidden` is read
/// as its definition says, not by its name: a call dropped (a statement of its own)
/// turns no one away where the function only builds the response. By name only where
/// the callee is a package's (`unauthorized()` of `next/navigation`). As a matrix: how
/// it is written (imported, a static of an imported class, a member of an imported
/// namespace) x how it is used (dropped in the branch, returned in it, dropped in a
/// helper the route returns the result of).
#[test]
fn a_dropped_call_of_a_repository_builder_named_unauthorized_refuses_no_one() {
    let head = "import { NextResponse } from \"next/server\";\nimport { getServerSession } from \"next-auth\";\n";
    let lib = "import { NextResponse } from \"next/server\";\nexport function unauthorized() {\n  return NextResponse.json({ error: \"no\" }, { status: 401 });\n}\nexport class ApiErrors {\n  static unauthorized() {\n    return NextResponse.json({ error: \"no\" }, { status: 401 });\n  }\n}\n";
    let guard = "import { getServerSession } from \"next-auth\";\nimport { unauthorized } from \"./http\";\nexport async function requireAuth() {\n  const session = await getServerSession();\n  if (!session) { unauthorized(); }\n  return null;\n}\n";
    let calls = [
        (
            "imported",
            "import { unauthorized } from \"@/lib/http\";\n",
            "unauthorized()",
        ),
        (
            "a static",
            "import { ApiErrors } from \"@/lib/http\";\n",
            "ApiErrors.unauthorized()",
        ),
        (
            "a namespace",
            "import * as http from \"@/lib/http\";\n",
            "http.unauthorized()",
        ),
    ];
    let mut files: Vec<(String, String)> = vec![
        ("lib/http.ts".into(), lib.into()),
        ("lib/guard.ts".into(), guard.into()),
    ];
    let mut want = Vec::new();
    for (i, (how, import, call)) in calls.iter().enumerate() {
        files.push((
            format!("app/api/d{i}/route.ts"),
            format!("{head}{import}export async function GET() {{\n  const session = await getServerSession();\n  if (!session) {{ {call}; }}\n  return NextResponse.json([]);\n}}\n"),
        ));
        // A static method is read through its class: not nothing.
        want.push((
            format!("/api/d{i}"),
            if *how == "a static" {
                "unknown"
            } else {
                "none"
            },
            format!("{how}, dropped"),
        ));
        files.push((
            format!("app/api/e{i}/route.ts"),
            format!("{head}{import}export async function GET() {{\n  const session = await getServerSession();\n  if (!session) return {call};\n  return NextResponse.json([]);\n}}\n"),
        ));
    }
    files.push((
        "app/api/helper/route.ts".into(),
        "import { requireAuth } from \"@/lib/guard\";\nexport async function GET() {\n  const denied = await requireAuth();\n  if (denied) return denied;\n  return Response.json({ secret: true });\n}\n".into(),
    ));
    want.push((
        "/api/helper".to_string(),
        "none",
        "a helper that drops it".to_string(),
    ));
    let files: Vec<(&str, String)> = files.iter().map(|(p, b)| (p.as_str(), b.clone())).collect();
    let states = next_states(&files);
    let wrong = misread(&states, &want, false);
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
    // Returned in the branch, the same call is the refusal a check answers with:
    // never read as nothing.
    for (i, (how, ..)) in calls.iter().enumerate() {
        let got = states
            .get(&format!("/api/e{i}"))
            .map_or("absent", String::as_str);
        assert_ne!(got, "none", "returned, {how}: {states:?}");
    }
}

/// [STRICT] A guard called for some of the requests only is the guard of those: under
/// a branch, in a callback run once per element, after a return that serves, or in an
/// `&&` it is the right side of, the route is unknown, never known. Called for every
/// request it stays known. As a matrix over Express and Next.js handlers.
#[test]
fn a_guard_called_for_some_requests_only_is_unknown_in_typescript() {
    let auth = "import jwt from \"jsonwebtoken\";\nexport function requireAuth(req: any) {\n  const token = req.headers.authorization;\n  if (!token) throw Object.assign(new Error(\"no\"), { status: 401 });\n  return jwt.verify(token, process.env.SECRET!);\n}\n";
    let uses: &[(&str, &str, &str)] = &[
        ("for every request", "  requireAuth(req);\n", "known"),
        (
            "under a branch",
            "  if (req.headers[\"x-internal\"] !== \"1\") requireAuth(req);\n",
            "unknown",
        ),
        (
            "under a branch with a block",
            "  if (req.query.mode === \"strict\") {\n    requireAuth(req);\n  }\n",
            "unknown",
        ),
        (
            "in an element callback",
            "  (req.body.ids as string[]).forEach(() => requireAuth(req));\n",
            "unknown",
        ),
        (
            "after a return that serves",
            "  if (req.query.preview) return res.json({ preview: true });\n  requireAuth(req);\n",
            "unknown",
        ),
        (
            "right of an and",
            "  req.query.strict && requireAuth(req);\n",
            "unknown",
        ),
    ];
    let mut app = "import express from \"express\";\nimport { requireAuth } from \"./auth\";\nconst app = express();\n".to_string();
    let mut want = Vec::new();
    for (i, (name, body, reads)) in uses.iter().enumerate() {
        app += &format!(
            "app.get(\"/r{i}\", (req, res) => {{\n{body}  res.json({{ secret: true }});\n}});\n"
        );
        want.push((format!("/r{i}"), *reads, (*name).to_string()));
    }
    app += "export default app;\n";
    let mut files = Files::new();
    files.insert("package.json".into(), "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"jsonwebtoken\": \"9.0.0\" } }\n".into());
    files.insert("src/auth.ts".into(), auth.into());
    files.insert("src/app.ts".into(), app);
    let dir = write(&files);
    let states = both_states(dir.path());
    let wrong: Vec<String> = want
        .iter()
        .filter_map(|(route, reads, name)| {
            let (map, inv) = states
                .get(&format!("GET {route}"))
                .cloned()
                .unwrap_or_else(|| ("absent".into(), "absent".into()));
            (map != inv || map != *reads)
                .then(|| format!("{name} {route}: map {map}, inventory {inv}, expected {reads}"))
        })
        .collect();
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

// ---------------------------------------------------------------------------
// TypeScript lowering 75: the follow-up to the final review (findings 7 to 11).
// ---------------------------------------------------------------------------

/// [STRICT] A check that answers 401 where the secret MATCHES (`if (header ===
/// process.env.SECRET) return 401`, `if (timingSafeEqual(a, b)) return 401`) is no
/// check of who calls, and a local the check is read through that the body assigns more
/// than once is not read: unknown on both surfaces, never known. The right polarity
/// stays a service's check. As a matrix: the compare (an equality on a header, a
/// constant-time compare, one bound to a local) x the shape of the branch (refused
/// where it fails, refused where it holds, the `else` of either, a local assigned a
/// second time before the test).
#[test]
fn a_check_refusing_where_the_secret_matches_or_read_through_a_reassigned_local_is_unknown() {
    let head = "import { timingSafeEqual } from \"crypto\";\nconst secret = Buffer.from(process.env.CRON_SECRET ?? \"\");\n";
    let given = "  const given = Buffer.from(req.headers.get(\"authorization\") ?? \"\");\n";
    let refuse = "new Response(null, { status: 401 })";
    let ok = "Response.json({ ok: true })";
    // (how the compare is written, the test that is true where it fails, the test that is
    // true where it holds)
    let compares: &[(&str, &str, &str)] = &[
        (
            "an equality on a header",
            "req.headers.get(\"authorization\") !== process.env.CRON_SECRET",
            "req.headers.get(\"authorization\") === process.env.CRON_SECRET",
        ),
        (
            "a constant-time compare",
            "!timingSafeEqual(given, secret)",
            "timingSafeEqual(given, secret)",
        ),
    ];
    let mut files: Vec<(String, String)> = Vec::new();
    let mut want = Vec::new();
    let mut add = |name: String, body: String, reads: &'static str| {
        let i = files.len();
        let route = format!("/api/p{i}");
        files.push((
            format!("app{route}/route.ts"),
            format!("{head}export async function GET(req: Request) {{\n{given}{body}}}\n"),
        ));
        want.push((route, reads, name));
    };
    for (how, fails, holds) in compares {
        add(
            format!("{how}, refused where it fails"),
            format!("  if ({fails}) {{\n    return {refuse};\n  }}\n  return {ok};\n"),
            "none",
        );
        add(
            format!("{how}, refused where it holds"),
            format!("  if ({holds}) {{\n    return {refuse};\n  }}\n  return {ok};\n"),
            "unknown",
        );
        add(
            format!("{how}, served where it holds, refused in the else"),
            format!(
                "  if ({holds}) {{\n    return {ok};\n  }} else {{\n    return {refuse};\n  }}\n"
            ),
            "none",
        );
        add(
            format!("{how}, served where it fails, refused in the else"),
            format!(
                "  if ({fails}) {{\n    return {ok};\n  }} else {{\n    return {refuse};\n  }}\n"
            ),
            "unknown",
        );
    }
    // The answer of a constant-time compare held in a local, tested as it is.
    let tse = "timingSafeEqual(given, secret)";
    add(
        "a local bound to the compare, refused where it fails".into(),
        format!(
            "  const good = {tse};\n  if (!good) {{\n    return {refuse};\n  }}\n  return {ok};\n"
        ),
        // (As it was: the compare's operands are not read through the local, and a
        // refusal where it fails is the check it is.)
        "known",
    );
    add(
        "a local bound to the compare, refused where it holds".into(),
        format!(
            "  const good = {tse};\n  if (good) {{\n    return {refuse};\n  }}\n  return {ok};\n"
        ),
        "unknown",
    );
    // The local is assigned more than once: what it holds at the test is not read.
    for (how, test) in [
        (
            "a compare",
            "req.headers.get(\"authorization\") === process.env.CRON_SECRET",
        ),
        ("a constant-time compare", tse),
    ] {
        add(
            format!("{how} in a local assigned again under a condition"),
            format!(
                "  let good = {test};\n  if (process.env.NODE_ENV === \"development\") good = true;\n  if (!good) {{\n    return {refuse};\n  }}\n  return {ok};\n"
            ),
            "unknown",
        );
        add(
            format!("{how} in a local declared false and assigned later"),
            format!(
                "  let good = false;\n  good = {test};\n  if (!good) {{\n    return {refuse};\n  }}\n  return {ok};\n"
            ),
            "unknown",
        );
        add(
            format!("{how} in a local assigned again before an unrelated test"),
            format!(
                "  let good = {test};\n  good = good && given.length > 0;\n  if (!good) {{\n    return {refuse};\n  }}\n  return {ok};\n"
            ),
            "unknown",
        );
    }
    let files: Vec<(&str, String)> = files.iter().map(|(p, b)| (p.as_str(), b.clone())).collect();
    let wrong = misread(&next_states(&files), &want, true);
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// [STRICT] Stripe's `constructEvent` and svix's `verify` stop the request only with the
/// sending service's secret: one written in the code (`""`, `"whsec_..."`, a template
/// with nothing in it) is found and not proven, unknown on both surfaces. A secret read
/// from the environment (inline, or a module constant bound to one) is as it was. As a
/// matrix: the verifier (`constructEvent`, `await constructEventAsync`, svix `new
/// Webhook(secret).verify`) x where the secret comes from.
#[test]
fn a_webhook_verifier_given_a_secret_written_in_the_code_is_not_proven() {
    let head = "import Stripe from \"stripe\";\nimport { Webhook } from \"svix\";\nconst stripe = new Stripe(process.env.STRIPE_KEY!);\nconst WH_SECRET = process.env.STRIPE_WH!;\n";
    let read = "  const body = await req.text();\n  const sig = req.headers.get(\"stripe-signature\") ?? \"\";\n";
    let secrets: &[(&str, &str, &str)] = &[
        ("an empty string", "\"\"", "unknown"),
        ("a string", "\"whsec_live_1234\"", "unknown"),
        (
            "a template with nothing in it",
            "`whsec_live_1234`",
            "unknown",
        ),
        ("an environment read", "process.env.STRIPE_WH!", "none"),
        (
            "a module constant read from the environment",
            "WH_SECRET",
            "none",
        ),
    ];
    // (the verifier written with the secret `S`; what it is)
    let verifiers: &[(&str, &str)] = &[
        (
            "  stripe.webhooks.constructEvent(body, sig, S);\n",
            "constructEvent",
        ),
        (
            "  await stripe.webhooks.constructEventAsync(body, sig, S);\n",
            "constructEventAsync awaited",
        ),
        (
            "  new Webhook(S).verify(body, { \"svix-id\": req.headers.get(\"svix-id\") ?? \"\", \"svix-timestamp\": req.headers.get(\"svix-timestamp\") ?? \"\", \"svix-signature\": req.headers.get(\"svix-signature\") ?? \"\" });\n",
            "svix verify",
        ),
    ];
    let mut files: Vec<(String, String)> = Vec::new();
    let mut want = Vec::new();
    for (i, (how, secret, reads)) in secrets.iter().enumerate() {
        for (j, (verify, name)) in verifiers.iter().enumerate() {
            let route = format!("/api/s{i}x{j}");
            files.push((
                format!("app{route}/route.ts"),
                format!(
                    "{head}export async function POST(req: Request) {{\n{read}{}  return Response.json({{ ok: true }});\n}}\n",
                    verify.replace('S', secret)
                ),
            ));
            want.push((
                format!("POST {route}"),
                *reads,
                format!("{name} with {how}"),
            ));
        }
    }
    let files: Vec<(&str, String)> = files.iter().map(|(p, b)| (p.as_str(), b.clone())).collect();
    let wrong = misread(&next_states(&files), &want, true);
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// [STRICT] A branch that answers 401 under a condition that reads nothing of the request
/// or the caller (an environment flag, a limit on the size of the body) is no sign-in
/// check, written in the route or in a helper of the repository (with the response
/// built in its file or in another module): the route reads as it would without it,
/// never "known". A condition that reads a credential is the check it was. As a matrix:
/// the condition x where it is written.
#[test]
fn a_401_under_a_condition_that_reads_nothing_of_the_caller_is_no_sign_in_check() {
    let deny_import = "import { deny } from \"@/lib/responses\";\n";
    let local = "import { NextResponse } from \"next/server\";\nfunction localDeny() {\n  return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });\n}\n";
    let conditions: &[(&str, &str, &str)] = &[
        (
            "an environment flag against a literal",
            "process.env.MAINTENANCE === \"1\"",
            "none",
        ),
        (
            "an environment flag tested",
            "process.env.MAINTENANCE",
            "none",
        ),
        (
            "an environment flag and a literal",
            "!process.env.OPEN || process.env.MODE !== \"live\"",
            "none",
        ),
        (
            "a limit on the size of the body",
            "Number(req.headers.get(\"content-length\")) > 1000000",
            "none",
        ),
        (
            "a limit on the size of the body, with the environment",
            "Number(req.headers.get(\"content-length\")) > Number(process.env.MAX_BYTES)",
            "none",
        ),
        (
            "the type of the body",
            "req.headers.get(\"content-type\") !== \"application/json\"",
            "none",
        ),
        // What reads a credential is a check.
        (
            "a credential header missing",
            "!req.headers.get(\"x-api-key\")",
            "known",
        ),
        (
            "a credential and a flag",
            "!req.headers.get(\"x-api-key\") || process.env.MAINTENANCE === \"1\"",
            "known",
        ),
    ];
    // (where it is written, the refusal there, the code around it)
    let mut files: Vec<(String, String)> = vec![
        (
            "lib/responses.ts".into(),
            "import { NextResponse } from \"next/server\";\nexport function deny() {\n  return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });\n}\n".into(),
        ),
    ];
    let mut want = Vec::new();
    for (i, (how, test, reads)) in conditions.iter().enumerate() {
        // In the route.
        let route = format!("/api/c{i}a");
        files.push((
            format!("app{route}/route.ts"),
            format!("export async function GET(req: Request) {{\n  if ({test}) return new Response(null, {{ status: 401 }});\n  return Response.json({{ secret: true }});\n}}\n"),
        ));
        want.push((route, *reads, format!("{how}, in the route")));
        // In a helper whose refusal is built in another module.
        files.push((
            format!("lib/gate{i}.ts"),
            format!("{deny_import}export async function gate(req: Request) {{\n  if ({test}) return deny();\n  return null;\n}}\n"),
        ));
        let route = format!("/api/c{i}b");
        files.push((
            format!("app{route}/route.ts"),
            format!("import {{ gate }} from \"@/lib/gate{i}\";\nexport async function GET(req: Request) {{\n  const denied = await gate(req);\n  if (denied) return denied;\n  return Response.json({{ secret: true }});\n}}\n"),
        ));
        want.push((
            route,
            *reads,
            format!("{how}, in a helper with the response from another module"),
        ));
        // In a helper whose refusal is built in its own file.
        files.push((
            format!("lib/local{i}.ts"),
            format!("{local}export async function gate(req: Request) {{\n  if ({test}) return localDeny();\n  return null;\n}}\n"),
        ));
        let route = format!("/api/c{i}c");
        files.push((
            format!("app{route}/route.ts"),
            format!("import {{ gate }} from \"@/lib/local{i}\";\nexport async function GET(req: Request) {{\n  const denied = await gate(req);\n  if (denied) return denied;\n  return Response.json({{ secret: true }});\n}}\n"),
        ));
        want.push((
            route,
            *reads,
            format!("{how}, in a helper with the response from its file"),
        ));
        // In a helper that answers in place.
        files.push((
            format!("lib/inline{i}.ts"),
            format!("import {{ NextResponse }} from \"next/server\";\nexport async function gate(req: Request) {{\n  if ({test}) return NextResponse.json({{}}, {{ status: 401 }});\n  return null;\n}}\n"),
        ));
        let route = format!("/api/c{i}d");
        files.push((
            format!("app{route}/route.ts"),
            format!("import {{ gate }} from \"@/lib/inline{i}\";\nexport async function GET(req: Request) {{\n  const denied = await gate(req);\n  if (denied) return denied;\n  return Response.json({{ secret: true }});\n}}\n"),
        ));
        want.push((
            route,
            *reads,
            format!("{how}, in a helper that answers in place"),
        ));
    }
    let files: Vec<(&str, String)> = files.iter().map(|(p, b)| (p.as_str(), b.clone())).collect();
    let wrong = misread(&next_states(&files), &want, false);
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// [STRICT] A Next.js configuration whose rewrites are not read is unknown for the routes a
/// rewrite may reach from outside the middleware's matcher: through a spread of
/// anything but an object written in place, a re-export, a call that merges into the
/// exported binding (`Object.assign(nextConfig, base)`). An object written in place
/// is read. As a matrix: the shape x the module kind.
#[test]
fn next_a_configuration_that_is_spread_re_exported_or_merged_into_is_not_read() {
    let route = "export async function GET() {\n  return Response.json([]);\n}\n";
    let mw = "import { NextResponse, type NextRequest } from \"next/server\";\nexport function middleware(req: NextRequest) {\n  if (!req.cookies.get(\"session\")) {\n    return new NextResponse(null, { status: 401 });\n  }\n  return NextResponse.next();\n}\nexport const config = { matcher: [\"/api/admin/:path*\"] };\n";
    // The rewrite sits in the module it is imported from. (esm, cjs)
    let base_esm = "export default { async rewrites() { return [{ source: \"/open/:path*\", destination: \"/api/admin/:path*\" }]; } };\n";
    let base_cjs = "module.exports = { async rewrites() { return [{ source: \"/open/:path*\", destination: \"/api/admin/:path*\" }]; } };\n";
    // (shape, ES module, CommonJS, what the route reads)
    let shapes: &[(&str, &str, &str, &str)] = &[
        (
            "a spread of an import",
            "import base from \"./next.base.mjs\";\nexport default { ...base, reactStrictMode: true };\n",
            "const base = require(\"./next.base.js\");\nmodule.exports = { ...base, reactStrictMode: true };\n",
            "unknown",
        ),
        (
            "a spread through a const",
            "import base from \"./next.base.mjs\";\nconst nextConfig = { ...base };\nexport default nextConfig;\n",
            "const base = require(\"./next.base.js\");\nconst nextConfig = { ...base };\nmodule.exports = nextConfig;\n",
            "unknown",
        ),
        (
            "a spread of a call",
            "import base from \"./next.base.mjs\";\nexport default { ...base(), reactStrictMode: true };\n",
            "const base = require(\"./next.base.js\");\nmodule.exports = { ...base(), reactStrictMode: true };\n",
            "unknown",
        ),
        (
            "Object.assign into the binding",
            "import base from \"./next.base.mjs\";\nconst nextConfig = { reactStrictMode: true };\nObject.assign(nextConfig, base);\nexport default nextConfig;\n",
            "const base = require(\"./next.base.js\");\nconst nextConfig = { reactStrictMode: true };\nObject.assign(nextConfig, base);\nmodule.exports = nextConfig;\n",
            "unknown",
        ),
        (
            "a merge into the binding",
            "import base from \"./next.base.mjs\";\nimport merge from \"lodash/merge\";\nconst nextConfig = { reactStrictMode: true };\nmerge(nextConfig, base);\nexport default nextConfig;\n",
            "const base = require(\"./next.base.js\");\nconst merge = require(\"lodash/merge\");\nconst nextConfig = { reactStrictMode: true };\nmerge(nextConfig, base);\nmodule.exports = nextConfig;\n",
            "unknown",
        ),
        (
            "Object.assign of a new object",
            "import base from \"./next.base.mjs\";\nexport default Object.assign({}, base, { reactStrictMode: true });\n",
            "const base = require(\"./next.base.js\");\nmodule.exports = Object.assign({}, base, { reactStrictMode: true });\n",
            "unknown",
        ),
        // Controls: what the file says is read.
        (
            "an object written in place",
            "export default { reactStrictMode: true };\n",
            "module.exports = { reactStrictMode: true };\n",
            "known",
        ),
        (
            "a spread of an object written in place",
            "export default { ...{ reactStrictMode: true } };\n",
            "module.exports = { ...{ reactStrictMode: true } };\n",
            "known",
        ),
        (
            "Object.assign of another binding of the file",
            "const other = { poweredByHeader: false };\nconst nextConfig = { reactStrictMode: true };\nObject.assign(other, { trailingSlash: true });\nexport default nextConfig;\n",
            "const other = { poweredByHeader: false };\nconst nextConfig = { reactStrictMode: true };\nObject.assign(other, { trailingSlash: true });\nmodule.exports = nextConfig;\n",
            "known",
        ),
    ];
    // Re-exports are written in ES modules only.
    let reexports: &[(&str, &str, &str)] = &[
        (
            "a re-export of the default",
            "export { default } from \"./next.base.mjs\";\n",
            "unknown",
        ),
        (
            "a re-export under the name of the default",
            "export { default as default } from \"./next.base.mjs\";\n",
            "unknown",
        ),
        (
            "a namespace re-exported as the default",
            "export * as default from \"./next.base.mjs\";\n",
            "unknown",
        ),
    ];
    let mut wrong = Vec::new();
    let mut cells = 0;
    let mut judge = |what: String, files: Vec<(&str, String)>, want: &str| {
        cells += 1;
        let mut all: Files = [
            (
                "package.json",
                "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }\n".to_string(),
            ),
            ("middleware.ts", mw.to_string()),
            ("app/api/admin/users/route.ts", route.to_string()),
        ]
        .iter()
        .map(|(p, b)| ((*p).to_string(), b.clone()))
        .collect();
        for (p, b) in files {
            all.insert(p.to_string(), b);
        }
        let dir = write(&all);
        let states = both_states(dir.path());
        let (map, inv) = states
            .get("GET /api/admin/users")
            .cloned()
            .unwrap_or_else(|| ("absent".into(), "absent".into()));
        if map != inv || map != want {
            wrong.push(format!(
                "{what}: the practice map says {map}, the inventory {inv}, expected {want}"
            ));
        }
    };
    for (shape, esm, cjs, want) in shapes {
        judge(
            format!("{shape}, ES module"),
            vec![
                ("next.config.mjs", (*esm).to_string()),
                ("next.base.mjs", base_esm.to_string()),
            ],
            want,
        );
        judge(
            format!("{shape}, CommonJS"),
            vec![
                ("next.config.js", (*cjs).to_string()),
                ("next.base.js", base_cjs.to_string()),
            ],
            want,
        );
    }
    for (shape, esm, want) in reexports {
        judge(
            (*shape).to_string(),
            vec![
                ("next.config.mjs", (*esm).to_string()),
                ("next.base.mjs", base_esm.to_string()),
            ],
            want,
        );
    }
    // A binding exported under the name of the default is the configuration.
    judge(
        "a binding exported as the default".to_string(),
        vec![(
            "next.config.mjs",
            "const nextConfig = { reactStrictMode: true };\nexport { nextConfig as default };\n"
                .to_string(),
        )],
        "known",
    );
    assert!(
        wrong.is_empty(),
        "{} wrong of {cells} cells:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}
