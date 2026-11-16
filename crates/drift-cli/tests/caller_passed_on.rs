//! A value of the caller handed from a handler to the code that queries
//! (TypeScript): `listNotes(req.user.id)` in the handler, `where: { userId }` in
//! `listNotes(userId)`.
//!
//! A query filtered by a parameter was found and never proven: where the
//! parameter's value comes from was in no fact. The lowering now says what each
//! call hands the repository's code (the caller, a parameter, a literal) and which
//! parameter each filter value is read off, for functions and for the methods of a
//! class; the practice map follows a parameter to the calls of the route's own
//! bodies. Passed the caller, the filter is the route's scope. Passed what the
//! request chose (`listNotes(req.params.userId)`), it is the scope the caller asked
//! for, and proves nothing: the same service method is proven for one route and
//! not for another.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// `METHOD route` -> `known <mechanisms>`, `none`, or `unknown <reason>`.
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
                        .map(|k| k.split(':').next().unwrap_or_default())
                        .collect();
                    format!("known {}", mechanisms.join("+"))
                }
                "unknown" => format!("unknown {}", u["reason"].as_str().unwrap_or_default()),
                other => other.to_string(),
            };
            (u["symbol"].as_str().unwrap_or_default().to_string(), said)
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

const DB: &str =
    "import { PrismaClient } from \"@prisma/client\";\nexport const prisma = new PrismaClient();\n";

#[test]
fn a_function_given_the_caller_filters_by_the_caller() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"@prisma/client\": \"5.20.0\" } }\n",
        ),
        ("src/db.ts", DB),
        (
            "src/auth.ts",
            "export function requireAuth(req: any, res: any, next: any) {\n  if (!req.user) {\n    return res.status(401).json({ error: \"unauthorized\" });\n  }\n  next();\n}\n",
        ),
        (
            "src/notes.ts",
            r#"import { prisma } from "./db";

export function listNotes(userId: string) {
  return prisma.note.findMany({ where: { userId } });
}

export function oneNote(userId: string, id: string) {
  return prisma.note.findFirst({ where: { id, userId: userId } });
}
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { requireAuth } from "./auth";
import { listNotes, oneNote } from "./notes";

const app = express();

app.get("/notes", requireAuth, async (req: any, res) => {
  res.json(await listNotes(req.user.id));
});

app.get("/notes/:id", requireAuth, async (req: any, res) => {
  const me = req.user.id;
  res.json(await oneNote(me, req.params.id));
});

app.get("/as/:userId", requireAuth, async (req: any, res) => {
  res.json(await listNotes(req.params.userId));
});

app.get("/swapped/:id", requireAuth, async (req: any, res) => {
  res.json(await oneNote(req.params.id, req.user.id));
});

export default app;
"#,
        ),
    ]);
    let got = authz(dir.path());
    assert_eq!(got["GET /notes"], "known owner_filter", "{got:?}");
    assert_eq!(got["GET /notes/:id"], "known owner_filter", "{got:?}");
    // The owner the request names: the scope asked for, not the caller's.
    assert!(got["GET /as/:userId"].starts_with("unknown"), "{got:?}");
    // The caller, handed over in the place of the row's id: the owner key is
    // filtered by what the request chose.
    assert!(got["GET /swapped/:id"].starts_with("unknown"), "{got:?}");
}

#[test]
fn a_service_method_given_the_caller_filters_by_the_caller() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"@nestjs/common\": \"10.0.0\", \"@nestjs/core\": \"10.0.0\", \"@prisma/client\": \"5.20.0\" } }\n",
        ),
        (
            "src/prisma.service.ts",
            "import { Injectable } from \"@nestjs/common\";\nimport { PrismaClient } from \"@prisma/client\";\n\n@Injectable()\nexport class PrismaService extends PrismaClient {}\n",
        ),
        (
            "src/auth.guard.ts",
            "import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from \"@nestjs/common\";\n\n@Injectable()\nexport class AuthGuard implements CanActivate {\n  canActivate(context: ExecutionContext): boolean {\n    const request = context.switchToHttp().getRequest();\n    if (!request.user) {\n      throw new UnauthorizedException();\n    }\n    return true;\n  }\n}\n",
        ),
        (
            "src/notes.service.ts",
            r#"import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  listFor(userId: number) {
    return this.prisma.note.findMany({ where: { userId } });
  }
}
"#,
        ),
        (
            "src/notes.controller.ts",
            r#"import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { NotesService } from "./notes.service";

@Controller("notes")
@UseGuards(AuthGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@Req() req: any) {
    return this.notes.listFor(req.user.id);
  }

  @Get("of/:userId")
  of(@Param("userId") userId: string) {
    return this.notes.listFor(Number(userId));
  }
}
"#,
        ),
    ]);
    let got = authz(dir.path());
    assert_eq!(got["GET /notes"], "known owner_filter", "{got:?}");
    // The same method, given what the request chose.
    assert!(
        got["GET /notes/of/:userId"].starts_with("unknown"),
        "{got:?}"
    );
}

#[test]
fn a_value_of_the_caller_handed_inside_an_object_written_in_place_is_followed_by_its_key() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"@prisma/client\": \"5.20.0\" } }\n",
        ),
        ("src/db.ts", DB),
        (
            "src/auth.ts",
            "export function requireAuth(req: any, res: any, next: any) {\n  if (!req.user) {\n    return res.status(401).json({ error: \"unauthorized\" });\n  }\n  next();\n}\n",
        ),
        (
            "src/notes.ts",
            r#"import { prisma } from "./db";

// Read off the options by a member.
export function listNotes(opts: { userId: string; take?: number }) {
  return prisma.note.findMany({ where: { userId: opts.userId }, take: opts.take });
}

// Read where the parameter is declared.
export function pinned({ userId, pinned }: { userId: string; pinned: boolean }) {
  return prisma.note.findMany({ where: { userId, pinned } });
}

// Read in the body.
export function drafts(opts: { userId: string }) {
  const { userId } = opts;
  return prisma.note.findMany({ where: { userId, draft: true } });
}

// Handed on, object to object.
export function recent(opts: { userId: string }) {
  return listNotes({ userId: opts.userId, take: 5 });
}
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { requireAuth } from "./auth";
import { drafts, listNotes, pinned, recent } from "./notes";

const app = express();

app.get("/notes", requireAuth, async (req: any, res) => {
  res.json(await listNotes({ userId: req.user.id, take: 20 }));
});

app.get("/pinned", requireAuth, async (req: any, res) => {
  res.json(await pinned({ userId: req.user.id, pinned: true }));
});

app.get("/drafts", requireAuth, async (req: any, res) => {
  const userId = req.user.id;
  res.json(await drafts({ userId }));
});

app.get("/recent", requireAuth, async (req: any, res) => {
  res.json(await recent({ userId: req.user.id }));
});

app.get("/as/:userId", requireAuth, async (req: any, res) => {
  res.json(await listNotes({ userId: req.params.userId }));
});

app.get("/spread", requireAuth, async (req: any, res) => {
  res.json(await listNotes({ userId: req.user.id, ...req.query }));
});

app.get("/other-key", requireAuth, async (req: any, res) => {
  res.json(await pinned({ userId: req.query.owner, pinned: req.user.id }));
});

app.get("/twice", requireAuth, async (req: any, res) => {
  res.json(await listNotes({ userId: req.user.id, userId: req.query.owner }));
});

export default app;
"#,
        ),
    ]);
    let got = authz(dir.path());
    assert_eq!(got["GET /notes"], "known owner_filter", "{got:?}");
    assert_eq!(got["GET /pinned"], "known owner_filter", "{got:?}");
    assert_eq!(got["GET /drafts"], "known owner_filter", "{got:?}");
    // Two hops, an object written in place at each.
    assert_eq!(got["GET /recent"], "known owner_filter", "{got:?}");
    // Under the same key, what the request chose.
    assert!(got["GET /as/:userId"].starts_with("unknown"), "{got:?}");
    // A spread after the key may put anything under it.
    assert!(got["GET /spread"].starts_with("unknown"), "{got:?}");
    // The caller's value under another key than the one the query filters by.
    assert!(got["GET /other-key"].starts_with("unknown"), "{got:?}");
    // The key written twice holds what was written last.
    assert!(got["GET /twice"].starts_with("unknown"), "{got:?}");
}
