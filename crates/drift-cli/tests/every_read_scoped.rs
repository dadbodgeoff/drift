//! A filter by the caller scopes its own query, not what the route reads
//! (TypeScript).
//!
//! A route was read as scoped to the caller as soon as one query every request
//! reaches was filtered by a value of the caller: `findMany({ where: { userId:
//! session.user.id } })` beside `findUnique({ where: { id: req.params.id } })`
//! read "owner filter", of a route that hands out any row by its id. The practice
//! map now asks it of every query of the route's own work, by what each call is
//! handed:
//!
//! - a query handed a filter is by the caller where one value of the filter is the
//!   caller's, is read off rows another query of the body selected by the caller,
//!   or is what every calling body passed that is one;
//! - a value under a negation or one alternative of several narrows nothing; a
//!   list of alternatives narrows where every one of them does;
//! - a model of a database client called with no filter selects every row, and a
//!   call handed only the row it writes selects none.
//!
//! Where another query selects rows by nothing of the caller the filter is found,
//! not proven (`other_read_unscoped`), and the line names that query.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// `METHOD route` -> `known <mechanisms>`, `none`, or `unknown <reason>
/// <obligation>`.
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
                _ => format!(
                    "unknown {} {}",
                    u["reason"].as_str().unwrap_or_default(),
                    u["not_proven"]["obligation"].as_str().unwrap_or_default()
                )
                .trim_end()
                .to_string(),
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

fn app(server: &str) -> tempfile::TempDir {
    write(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"@prisma/client\": \"5.20.0\" } }\n",
        ),
        (
            "src/db.ts",
            "import { PrismaClient } from \"@prisma/client\";\nexport const prisma = new PrismaClient();\n",
        ),
        ("src/auth.ts", AUTH),
        ("src/server.ts", server),
    ])
}

const HEAD: &str = r#"import express from "express";
import { requireAuth } from "./auth";
import { prisma } from "./db";

const app = express();
"#;

#[test]
fn a_filter_by_the_caller_beside_a_query_by_what_the_request_names_is_not_the_routes_scope() {
    let dir = app(&format!(
        r#"{HEAD}
// Every query by the caller.
app.get("/notes", requireAuth, async (req: any, res) => {{
  const notes = await prisma.note.findMany({{ where: {{ userId: req.user.id }} }});
  const tags = await prisma.tag.findMany({{ where: {{ ownerId: req.user.id, archived: false }} }});
  res.json({{ notes, tags }});
}});

// One by the caller, one by the id the request names.
app.get("/notes/:id", requireAuth, async (req: any, res) => {{
  const mine = await prisma.note.count({{ where: {{ userId: req.user.id }} }});
  const note = await prisma.note.findUnique({{ where: {{ id: req.params.id }} }});
  res.json({{ mine, note }});
}});

// The same model called twice: once by the caller, once by the request.
app.get("/twice/:id", requireAuth, async (req: any, res) => {{
  const mine = await prisma.note.findMany({{ where: {{ userId: req.user.id }} }});
  const other = await prisma.note.findMany({{ where: {{ userId: req.params.id }} }});
  res.json({{ mine, other }});
}});

// Every row of another model.
app.get("/with-all", requireAuth, async (req: any, res) => {{
  const notes = await prisma.note.findMany({{ where: {{ userId: req.user.id }} }});
  const users = await prisma.user.findMany();
  res.json({{ notes, users }});
}});

// Every row, a selection of columns.
app.get("/with-columns", requireAuth, async (req: any, res) => {{
  const notes = await prisma.note.findMany({{ where: {{ userId: req.user.id }} }});
  const users = await prisma.user.findMany({{ select: {{ email: true }} }});
  res.json({{ notes, users }});
}});

export default app;
"#
    ));
    let got = authz(dir.path());
    assert!(
        got["GET /notes"].starts_with("known owner_filter"),
        "{got:?}"
    );
    for route in [
        "GET /notes/:id",
        "GET /twice/:id",
        "GET /with-all",
        "GET /with-columns",
    ] {
        assert_eq!(
            got[route], "unknown check_not_proven other_read_unscoped",
            "{route}: {got:?}"
        );
    }
    // The line names the query that is not by the caller.
    let out = Command::new(&*BIN)
        .args(["--no-cache", "practices", "--json", "--units"])
        .current_dir(dir.path())
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("another query of the route selects rows by nothing of the caller (`prisma.note.findUnique`)"),
        "{text}"
    );
}

#[test]
fn rows_read_off_the_callers_own_rows_and_rows_written_are_the_callers() {
    let dir = app(&format!(
        r#"{HEAD}
// The second query by a row the first selected by the caller.
app.get("/comments/:id", requireAuth, async (req: any, res) => {{
  const note = await prisma.note.findFirst({{ where: {{ id: req.params.id, userId: req.user.id }} }});
  const comments = await prisma.comment.findMany({{ where: {{ noteId: note.id }} }});
  res.json(comments);
}});

// By an item of the rows, and of what a promise settled to.
app.delete("/first", requireAuth, async (req: any, res) => {{
  const notes = await prisma.note.findMany({{ where: {{ userId: req.user.id }} }});
  const ids = await prisma.share
    .findMany({{ where: {{ userId: req.user.id }} }})
    .then((shares) => shares.map((s) => s.noteId));
  await prisma.note.delete({{ where: {{ id: notes[0].id }} }});
  await prisma.comment.deleteMany({{ where: {{ noteId: {{ in: ids }} }} }});
  res.status(204).end();
}});

// By a row the first query selected by what the request names: no one's.
app.get("/loose/:id", requireAuth, async (req: any, res) => {{
  const mine = await prisma.note.count({{ where: {{ userId: req.user.id }} }});
  const note = await prisma.note.findFirst({{ where: {{ id: req.params.id }} }});
  const comments = await prisma.comment.findMany({{ where: {{ noteId: note.id }} }});
  res.json({{ mine, comments }});
}});

// A row written beside the caller's own rows selects none.
app.post("/notes", requireAuth, async (req: any, res) => {{
  const count = await prisma.note.count({{ where: {{ userId: req.user.id }} }});
  await prisma.audit.create({{ data: {{ action: "note.create", count }} }});
  res.status(201).end();
}});

export default app;
"#
    ));
    let got = authz(dir.path());
    assert_eq!(got["GET /comments/:id"], "known owner_filter", "{got:?}");
    assert_eq!(got["DELETE /first"], "known owner_filter", "{got:?}");
    assert_eq!(got["POST /notes"], "known owner_filter", "{got:?}");
    assert_eq!(
        got["GET /loose/:id"], "unknown check_not_proven other_read_unscoped",
        "{got:?}"
    );
}

#[test]
fn a_value_under_a_negation_or_one_alternative_narrows_nothing() {
    let dir = app(&format!(
        r#"{HEAD}
const LIVE = {{ deletedAt: null }};

// Everyone's rows but the caller's.
app.get("/others", requireAuth, async (req: any, res) => {{
  res.json(await prisma.note.findMany({{ where: {{ NOT: {{ userId: req.user.id }} }} }}));
}});

// The caller's rows, or any public one.
app.get("/feed", requireAuth, async (req: any, res) => {{
  res.json(
    await prisma.note.findMany({{ where: {{ OR: [{{ userId: req.user.id }}, {{ public: true }}] }} }})
  );
}});

// The caller's own, or those of the caller's teams: every alternative is by the caller.
app.get("/segments", requireAuth, async (req: any, res) => {{
  const teamIds = await prisma.membership
    .findMany({{ where: {{ userId: req.user.id }} }})
    .then((rows) => rows.map((r) => r.teamId));
  res.json(
    await prisma.segment.findMany({{
      where: {{ OR: [{{ userId: req.user.id }}, {{ teamId: {{ in: teamIds }} }}] }},
    }})
  );
}});

// A spread of an object whose keys are written in the file puts those keys only.
app.get("/live", requireAuth, async (req: any, res) => {{
  res.json(await prisma.note.findMany({{ where: {{ userId: req.user.id, ...LIVE }} }}));
}});

// A spread of what the request sent may put anything under the key.
app.get("/any", requireAuth, async (req: any, res) => {{
  res.json(await prisma.note.findMany({{ where: {{ userId: req.user.id, ...req.query }} }}));
}});

export default app;
"#
    ));
    let got = authz(dir.path());
    assert!(got["GET /others"].starts_with("unknown"), "{got:?}");
    assert!(got["GET /feed"].starts_with("unknown"), "{got:?}");
    assert_eq!(got["GET /segments"], "known owner_filter", "{got:?}");
    assert_eq!(got["GET /live"], "known owner_filter", "{got:?}");
    assert!(got["GET /any"].starts_with("unknown"), "{got:?}");
}

#[test]
fn a_query_through_a_parameter_or_a_method_of_the_class_is_judged_as_any_other() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"@prisma/client\": \"5.20.0\" } }\n",
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

  // Through a method of the class, with what it was handed.
  listFor(userId: string) {
    return this.byOwner(userId);
  }

  private byOwner(userId: string) {
    return this.db.note.findMany({ where: { userId } });
  }

  // The caller's rows counted, then any row by its id.
  peek(userId: string, id: string) {
    this.db.note.count({ where: { userId } });
    return this.db.note.findUnique({ where: { id } });
  }
}

// The client as a parameter.
export async function countFor(db: any, userId: string, id: string) {
  const mine = await db.note.count({ where: { userId } });
  const other = await db.note.findUnique({ where: { id } });
  return { mine, other };
}
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { requireAuth } from "./auth";
import { prisma } from "./db";
import { NoteRepository, countFor } from "./notes";

const app = express();

app.get("/mine", requireAuth, async (req: any, res) => {
  const repo = new NoteRepository(prisma);
  res.json(await repo.listFor(req.user.id));
});

app.get("/peek/:id", requireAuth, async (req: any, res) => {
  const repo = new NoteRepository(prisma);
  res.json(await repo.peek(req.user.id, req.params.id));
});

app.get("/count/:id", requireAuth, async (req: any, res) => {
  res.json(await countFor(prisma, req.user.id, req.params.id));
});

export default app;
"#,
        ),
    ]);
    let got = authz(dir.path());
    assert_eq!(got["GET /mine"], "known owner_filter", "{got:?}");
    assert_eq!(
        got["GET /peek/:id"], "unknown check_not_proven other_read_unscoped",
        "{got:?}"
    );
    // A client no type names: what its methods do was not read, and the count by
    // the caller proves nothing of the route.
    assert!(got["GET /count/:id"].starts_with("unknown"), "{got:?}");
}
