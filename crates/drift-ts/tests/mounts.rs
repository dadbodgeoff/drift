//! A router mounted more than once answers on each mount, so each is an entry point
//! with its own route and the middleware of its own mount: Express and Hono, across
//! files and within one. What every mount gives a route is on its symbol's `wraps`;
//! what one mount adds is in `FileFacts::mounts`.

use std::fs;
use std::path::Path;

use drift_core::RepoFacts;
use drift_ts::{ScanOptions, scan};

fn repo(files: &[(&str, &str)]) -> RepoFacts {
    let dir = tempfile::tempdir().expect("tempdir");
    for (path, text) in files {
        let p = dir.path().join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
    scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .expect("scan")
    .0
}

/// Each http entry point of `path`: `METHOD route | the wraps its own mount adds (`?`
/// when two mounts under one path differ) | the wraps of its symbol`.
fn served(r: &RepoFacts, path: &str) -> Vec<String> {
    let f = r
        .files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"));
    let names = |ws: &[drift_core::Wrap]| -> String {
        ws.iter()
            .map(|w| w.wrapper.rsplit('#').next().unwrap_or_default())
            .collect::<Vec<_>>()
            .join(" ")
    };
    let mut out: Vec<String> = f
        .entry_points
        .iter()
        .filter(|e| e.kind == "http")
        .map(|e| {
            let symbol = f.symbols.iter().find(|s| s.name == e.symbol).unwrap();
            format!(
                "{} {} | {}{} | {}",
                e.method.as_deref().unwrap_or("-"),
                e.route.as_deref().unwrap_or("-"),
                names(f.mount_wraps(e)),
                if f.mount(e).is_some_and(|m| m.opaque) {
                    "?"
                } else {
                    ""
                },
                names(&symbol.wraps)
            )
        })
        .collect();
    out.sort();
    out
}

const AUTH: &str = "export function requireAdmin(req: any, res: any, next: any) {\n  if (!req.headers.authorization) { res.status(401).end(); return; }\n  next();\n}\n\nexport function audit(req: any, res: any, next: any) {\n  next();\n}\n";
const PACKAGE: &str =
    "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"hono\": \"4.0.0\" } }\n";

#[test]
fn an_express_router_mounted_twice_has_a_route_and_the_middleware_of_each_mount() {
    let users = "import { Router } from \"express\";\nimport { audit } from \"../auth\";\n\nexport const users = Router();\nusers.get(\"/users\", audit, (req, res) => { res.json([]); });\n";
    // Whichever prefix sorts first, the guarded mount is the guarded one.
    for (guarded, open) in [("/admin", "/public"), ("/zadmin", "/open")] {
        let app = format!(
            "import express, {{ Router }} from \"express\";\nimport {{ users }} from \"./routes/users\";\nimport {{ requireAdmin }} from \"./auth\";\n\nconst app = express();\nconst local = Router();\nlocal.get(\"/ping\", (req, res) => {{ res.json({{}}); }});\napp.use(\"/local\", local);\napp.use(\"{guarded}\", requireAdmin, users);\napp.use(\"{open}\", users);\napp.get(\"/health\", (req, res) => {{ res.json({{}}); }});\nexport default app;\n"
        );
        let r = repo(&[
            ("package.json", PACKAGE),
            ("src/auth.ts", AUTH),
            ("src/routes/users.ts", users),
            ("src/app.ts", &app),
        ]);
        let mut want = vec![
            format!("GET {guarded}/users | requireAdmin | audit"),
            format!("GET {open}/users |  | audit"),
        ];
        want.sort();
        assert_eq!(served(&r, "src/routes/users.ts"), want);
        // A router mounted in the file that defines it is under that mount too.
        assert_eq!(
            served(&r, "src/app.ts"),
            ["GET /health |  | ", "GET /local/ping |  | "]
        );
    }
}

/// `app.use(router)` with no path mounts the router where the app is, behind the
/// middleware the app has in use by then and what is listed before it; a router
/// mounted through another is under both prefixes and behind both sets.
#[test]
fn an_express_router_is_followed_through_pathless_and_nested_mounts() {
    let r = repo(&[
        ("package.json", PACKAGE),
        ("src/auth.ts", AUTH),
        (
            "src/users.ts",
            "import { Router } from \"express\";\n\nconst router = Router();\nrouter.get(\"/users\", (req, res) => { res.json([]); });\nexport default router;\n",
        ),
        (
            "src/api.ts",
            "import { Router } from \"express\";\nimport users from \"./users\";\nimport { audit } from \"./auth\";\n\nexport const api = Router();\napi.use(audit);\napi.use(users);\n",
        ),
        (
            "src/app.ts",
            "import express from \"express\";\nimport { api } from \"./api\";\nimport users from \"./users\";\nimport { requireAdmin } from \"./auth\";\n\nconst app = express();\napp.use(\"/v1\", requireAdmin, api);\napp.use(\"/v2\", api);\napp.use(users);\nexport default app;\n",
        ),
    ]);
    assert_eq!(
        served(&r, "src/users.ts"),
        [
            "GET /users |  | ",
            "GET /v1/users | requireAdmin audit | ",
            "GET /v2/users | audit | ",
        ]
    );
    // The same path twice with different middleware: which mount answers is the
    // order of registration, which is not kept.
    let r = repo(&[
        ("package.json", PACKAGE),
        ("src/auth.ts", AUTH),
        (
            "src/users.ts",
            "import { Router } from \"express\";\n\nexport const users = Router();\nusers.get(\"/users\", (req, res) => { res.json([]); });\n",
        ),
        (
            "src/app.ts",
            "import express from \"express\";\nimport { users } from \"./users\";\nimport { requireAdmin } from \"./auth\";\n\nconst app = express();\napp.use(\"/v1\", requireAdmin, users);\napp.use(\"/v1\", users);\nexport default app;\n",
        ),
    ]);
    assert_eq!(served(&r, "src/users.ts"), ["GET /v1/users | ? | "]);
}

#[test]
fn a_hono_app_mounted_twice_has_a_route_and_the_middleware_of_each_mount() {
    let r = repo(&[
        ("package.json", PACKAGE),
        (
            "src/auth.ts",
            "export async function requireAdmin(c: any, next: any) {\n  if (!c.req.header(\"authorization\")) { return c.json({}, 401); }\n  await next();\n}\n",
        ),
        (
            "src/users.ts",
            "import { Hono } from \"hono\";\n\nexport const users = new Hono();\nusers.get(\"/users\", (c) => c.json([]));\n",
        ),
        (
            "src/app.ts",
            "import { Hono } from \"hono\";\nimport { users } from \"./users\";\nimport { requireAdmin } from \"./auth\";\n\nconst app = new Hono();\nconst admin = new Hono();\nadmin.use(requireAdmin);\nadmin.route(\"/\", users);\napp.route(\"/admin\", admin);\napp.route(\"/public\", users);\napp.get(\"/health\", (c) => c.json({}));\nexport default app;\n",
        ),
    ]);
    assert_eq!(
        served(&r, "src/users.ts"),
        [
            "GET /admin/users | requireAdmin | ",
            "GET /public/users |  | ",
        ]
    );
    assert_eq!(served(&r, "src/app.ts"), ["GET /health |  | "]);
}
