//! Bodies the practice map could not read to the end, read by what the code does
//! (TypeScript).
//!
//! - A method called on a local a class of the repository builds (`const repo =
//!   new NoteRepository(db); repo.listFor(user.id)`) is that class's method, with
//!   what it is handed: the route is read through it.
//! - A binding made by a method of a binding that is itself built from a library
//!   alone (`const log = logger.child({ ... })`) is the library's: a call of it is
//!   no body of the repository left unread.
//! - A client a Prisma schema says is generated into a directory of the
//!   repository (`generator client { output = "./generated" }`) is the database
//!   client though no file of it is committed: a query on it is data access, not
//!   a body that was not read.
//! - A role guard is proven by the body of the function a builder's step is given
//!   (`publicProcedure.use(isAdmin)`), and a member of the caller compared with a
//!   literal is a role whatever the refusal is answered with (tRPC's
//!   `UNAUTHORIZED` for a caller who is no admin).

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// Unit (route, or `KIND name` of a procedure) -> `known <mechanisms>`, `none`, or
/// `unknown <reason>`.
fn authz(root: &Path) -> BTreeMap<String, String> {
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
                    let mechanisms: Vec<&str> = key
                        .split('+')
                        .map(|m| m.split(':').next().unwrap_or_default())
                        .collect();
                    format!("known {}", mechanisms.join("+"))
                }
                "none" => "none".to_string(),
                _ => format!("unknown {}", u["reason"].as_str().unwrap_or_default()),
            };
            let name = match u["route"].as_str() {
                Some(route) => format!("{} {route}", u["method"].as_str().unwrap_or_default()),
                None => u["symbol"].as_str().unwrap_or_default().to_string(),
            };
            (name, said)
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

const AUTH: &str = "export function requireAuth(req: any, res: any, next: any) {\n  if (!req.user) {\n    return res.status(401).json({ error: \"unauthorized\" });\n  }\n  next();\n}\n";

#[test]
fn a_method_of_a_local_a_class_builds_is_read_as_the_classes_own() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"@prisma/client\": \"5.20.0\", \"pino\": \"9.0.0\" } }\n",
        ),
        (
            "src/log.ts",
            "import pino from \"pino\";\nexport const logger = pino();\n",
        ),
        (
            "src/db.ts",
            "import { PrismaClient } from \"@prisma/client\";\nexport const prisma = new PrismaClient();\n",
        ),
        ("src/auth.ts", AUTH),
        (
            "src/notes.ts",
            r#"import type { PrismaClient } from "@prisma/client";

export class NoteRepository {
  constructor(private db: PrismaClient) {}

  listFor(userId: string) {
    return this.db.note.findMany({ where: { userId } });
  }

  all() {
    return this.db.note.findMany({});
  }
}
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { requireAuth } from "./auth";
import { prisma } from "./db";
import { logger } from "./log";
import { NoteRepository } from "./notes";

const app = express();
// What a library's method hands back is the library's: a logger still.
const log = logger.child({ module: "notes" });

app.get("/mine", requireAuth, async (req: any, res) => {
  const repo = new NoteRepository(prisma);
  res.json(await repo.listFor(req.user.id));
});

app.get("/as/:userId", requireAuth, async (req: any, res) => {
  const repo = new NoteRepository(prisma);
  res.json(await repo.listFor(req.params.userId));
});

app.get("/all", requireAuth, async (req: any, res) => {
  const repo = new NoteRepository(prisma);
  log.info("every note");
  res.json(await repo.all());
});

export default app;
"#,
        ),
    ]);
    let got = authz(dir.path());
    // The class's own method, given the caller: its filter is the route's.
    assert_eq!(got["GET /mine"], "known owner_filter", "{got:?}");
    // Given what the request chose, the same method proves nothing.
    assert!(got["GET /as/:userId"].starts_with("unknown"), "{got:?}");
    // The method was read and filters by nothing: no authorization, said so.
    assert_eq!(got["GET /all"], "none", "{got:?}");
}

#[test]
fn a_client_a_schema_generates_into_the_repository_is_the_database_client() {
    let schema = "generator client {\n  provider = \"prisma-client\"\n  output   = \"../src/generated/prisma\"\n}\n\ndatasource db {\n  provider = \"postgresql\"\n}\n\nmodel Note {\n  id     String @id\n  userId String\n  text   String\n}\n";
    let server = r#"import express from "express";
import { requireAuth } from "./auth";
import { prisma } from "./db";

const app = express();

app.get("/notes", requireAuth, async (req: any, res) => {
  res.json(await prisma.note.findMany({ where: { userId: req.user.id } }));
});

app.get("/count", requireAuth, async (req: any, res) => {
  res.json({ notes: await prisma.note.count() });
});

export default app;
"#;
    let db = "import { PrismaClient } from \"./generated/prisma/client\";\n\nexport const prisma = new PrismaClient();\n";
    let files = |schema: &'static str, db: &'static str| {
        vec![
            (
                "package.json",
                "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n",
            ),
            ("prisma/schema.prisma", schema),
            ("src/db.ts", db),
            ("src/auth.ts", AUTH),
            ("src/server.ts", server),
        ]
    };
    let got = authz(write(&files(schema, db)).path());
    assert_eq!(got["GET /notes"], "known owner_filter", "{got:?}");
    // A query that filters by nothing, on a client that is read: no authorization.
    assert_eq!(got["GET /count"], "none", "{got:?}");

    // The client extended: an extension may filter every query, so a route that
    // filters by nothing is unknown, as with the package's own client.
    let extended = "import { PrismaClient } from \"./generated/prisma/client\";\n\nconst base = new PrismaClient();\nexport const prisma = base.$extends({});\n";
    let got = authz(write(&files(schema, extended)).path());
    assert_eq!(got["GET /notes"], "known owner_filter", "{got:?}");
    assert_eq!(got["GET /count"], "unknown unclassified", "{got:?}");

    // No schema says where a client is generated: what the extended binding is
    // built on is not known to be a database client, and the body is not read.
    let unsaid = "datasource db {\n  provider = \"postgresql\"\n}\n\nmodel Note {\n  id     String @id\n  userId String\n}\n";
    let got = authz(write(&files(unsaid, extended)).path());
    assert_eq!(got["GET /count"], "unknown body_unreadable", "{got:?}");
}

#[test]
fn a_role_guard_is_proven_by_the_function_a_builders_step_is_given() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"@trpc/server\": \"11.0.0\" } }\n",
        ),
        (
            "src/trpc.ts",
            "import { initTRPC } from \"@trpc/server\";\nexport const t = initTRPC.context<{ user?: { id: string; role: string; plan: string } }>().create();\nexport const router = t.router;\nexport const middleware = t.middleware;\nexport const procedure = t.procedure;\n",
        ),
        (
            "src/middleware.ts",
            r#"import { TRPCError } from "@trpc/server";
import { middleware } from "./trpc";

export const isAuthed = middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { user: ctx.user } });
});

// A caller who is no admin is answered as one who is not signed in.
export const isAdmin = isAuthed.unstable_pipe(({ ctx, next }) => {
  const { user } = ctx;
  if (user?.role !== "ADMIN") {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { user } });
});

// Refuses where the request says so, not by who calls.
export const isStaffWhenAsked = isAuthed.unstable_pipe(({ ctx, next, input }) => {
  if ((input as any)?.strict && ctx.user?.role !== "STAFF") {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx });
});
"#,
        ),
        (
            "src/procedures.ts",
            "import { isAdmin, isAuthed, isStaffWhenAsked } from \"./middleware\";\nimport { procedure } from \"./trpc\";\n\nexport const authedProcedure = procedure.use(isAuthed);\nexport const adminProcedure = procedure.use(isAdmin);\nexport const auditedAdminProcedure = adminProcedure.use(isAuthed);\nexport const staffProcedure = procedure.use(isStaffWhenAsked);\n",
        ),
        (
            "src/router.ts",
            r#"import { adminProcedure, auditedAdminProcedure, authedProcedure, staffProcedure } from "./procedures";
import { router } from "./trpc";

export const appRouter = router({
  purge: adminProcedure.mutation(async () => ({ ok: true })),
  audit: auditedAdminProcedure.query(async () => ({ ok: true })),
  staff: staffProcedure.query(async () => ({ ok: true })),
  ping: authedProcedure.query(async () => ({ ok: true })),
});
"#,
        ),
    ]);
    let got = authz(dir.path());
    assert_eq!(got["MUTATION purge"], "known role_guard", "{got:?}");
    // Built on the guarded procedure by one more step.
    assert_eq!(got["QUERY audit"], "known role_guard", "{got:?}");
    // The role is asked only where the request says so: found by the name, not
    // proven.
    assert!(!got["QUERY staff"].starts_with("known"), "{got:?}");
    // Signed in, and nothing asked of who they are.
    assert_eq!(got["QUERY ping"], "none", "{got:?}");
}
