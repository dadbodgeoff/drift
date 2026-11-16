//! A TypeScript query filtered under a tenant's key, with where the value comes from
//! ([`drift_core::Symbol::scoped_queries`]), in the listed reading only: what Python
//! writes for the same case, read from the filter values the lowering already
//! writes ([`drift_core::controls::FILTER_VALUE`]). Prisma `where` objects (a
//! relation filter, an `AND` list) and Drizzle conditions (`.where(eq(...))`,
//! `and(...)`, a relational query's `where`). Beside them, a body whose only calls
//! the facts do not record write the response
//! ([`drift_core::controls::UNREAD_RESPONDS`]).
//!
//! Each case has its twin that must not be said: a key under `OR`, a key named for
//! no tenant, the data a row is written with, a Drizzle `or`, a value the lowering
//! cannot trace, a call under a branch. The measured copy (what mining reads) holds
//! none of it.

use std::fs;
use std::path::Path;

use drift_core::{RepoFacts, ScopeSource};
use drift_ts::{ScanOptions, scan};

const PACKAGE: &str = r#"{ "name": "api", "dependencies": { "express": "4.19.2", "@prisma/client": "5.20.0", "drizzle-orm": "0.33.0", "jsonwebtoken": "9.0.2" } }"#;

const DB: &str = r#"
import { PrismaClient } from "@prisma/client";
import { drizzle } from "drizzle-orm/node-postgres";
export const prisma = new PrismaClient();
export const db = drizzle(process.env.DATABASE_URL);
"#;

const SCHEMA: &str = r#"
import { pgTable, text } from "drizzle-orm/pg-core";
export const projects = pgTable("projects", { id: text("id"), orgId: text("org_id") });
"#;

const SERVER: &str = r#"
import express from "express";
import jwt from "jsonwebtoken";
import { and, eq, or } from "drizzle-orm";
import { prisma, db } from "./db";
import { projects } from "./schema";
const app = express();
function requireUser(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "unauthenticated" });
  req.user = jwt.verify(token, process.env.JWT_KEY);
  next();
}
app.get("/sent/:orgId", requireUser, async (req, res) => {
  res.json(await prisma.project.findMany({ where: { orgId: req.params.orgId } }));
});
app.get("/mine", requireUser, async (req, res) => {
  res.json(await prisma.project.findMany({ where: { orgId: req.user.orgId } }));
});
app.get("/header", requireUser, async (req, res) => {
  res.json(await prisma.project.findMany({ where: { teamId: req.headers["x-team"] } }));
});
app.get("/relation", requireUser, async (req, res) => {
  res.json(await prisma.project.findMany({ where: { team: { id: req.user.teamId } } }));
});
app.get("/and/:orgId", requireUser, async (req, res) => {
  res.json(await prisma.project.findMany({ where: { AND: [{ orgId: req.params.orgId }, { archived: false }] } }));
});
app.get("/or", requireUser, async (req, res) => {
  res.json(await prisma.project.findMany({ where: { OR: [{ orgId: req.user.orgId }, { public: true }] } }));
});
app.get("/by-id/:id", requireUser, async (req, res) => {
  res.json(await prisma.project.findUnique({ where: { id: req.params.id } }));
});
app.post("/create/:orgId", requireUser, async (req, res) => {
  res.json(await prisma.project.create({ data: { orgId: req.params.orgId } }));
});
app.get("/branch/:orgId", requireUser, async (req, res) => {
  if (req.query.all) {
    return res.json(await prisma.project.findMany({ where: { orgId: req.params.orgId } }));
  }
  res.json([]);
});
app.get("/drizzle", requireUser, async (req, res) => {
  res.json(await db.select().from(projects).where(eq(projects.orgId, req.user.orgId)));
});
app.get("/drizzle-and/:orgId", requireUser, async (req, res) => {
  res.json(await db.select().from(projects).where(and(eq(projects.orgId, req.params.orgId), eq(projects.id, "x"))));
});
app.get("/drizzle-or", requireUser, async (req, res) => {
  res.json(await db.select().from(projects).where(or(eq(projects.orgId, req.user.orgId), eq(projects.id, "x"))));
});
app.get("/drizzle-query", requireUser, async (req, res) => {
  res.json(await db.query.projects.findFirst({ where: eq(projects.orgId, req.user.orgId) }));
});
app.get("/elsewhere", requireUser, async (req, res) => {
  const out = await prisma.project.findMany({ where: { orgId: req.user.orgId } });
  req.store.put(out);
  res.json(out);
});
"#;

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

fn server() -> RepoFacts {
    repo(&[
        ("package.json", PACKAGE),
        ("src/db.ts", DB),
        ("src/schema.ts", SCHEMA),
        ("src/server.ts", SERVER),
    ])
}

/// The scoped queries of the route `symbol` (`GET /mine`): the key and the source.
fn scoped(r: &RepoFacts, symbol: &str) -> Vec<(String, ScopeSource)> {
    r.files
        .iter()
        .find(|f| f.path == "src/server.ts")
        .expect("scanned")
        .symbols
        .iter()
        .find(|s| s.name == symbol)
        .unwrap_or_else(|| panic!("no {symbol}"))
        .scoped_queries
        .iter()
        .map(|q| (q.key.clone(), q.source))
        .collect()
}

fn has_control(r: &RepoFacts, symbol: &str, control: &str) -> bool {
    r.files
        .iter()
        .find(|f| f.path == "src/server.ts")
        .expect("scanned")
        .symbols
        .iter()
        .find(|s| s.name == symbol)
        .unwrap_or_else(|| panic!("no {symbol}"))
        .controls
        .iter()
        .any(|c| c == control)
}

/// Pins the Prisma cases: the tenant the request names (a path parameter, a
/// header), the caller's (a claim the verified token gives, through a relation
/// filter), and an `AND` list; and their twins: a key under `OR`, a key named for
/// no tenant (a lookup by id: no tenant query, whatever else it is), the data a row
/// is created with, and a filter only some requests run.
#[test]
fn prisma_filters_under_a_tenant_key_are_scoped_queries() {
    let listed = server().listed().into_owned();
    let k = |key: &str, s: ScopeSource| vec![(key.to_string(), s)];
    assert_eq!(
        scoped(&listed, "GET /sent/:orgId"),
        k("where.orgId", ScopeSource::Param)
    );
    assert_eq!(
        scoped(&listed, "GET /mine"),
        k("where.orgId", ScopeSource::Session)
    );
    assert_eq!(
        scoped(&listed, "GET /header"),
        k("where.teamId", ScopeSource::Header)
    );
    assert_eq!(
        scoped(&listed, "GET /relation"),
        k("where.team.id", ScopeSource::Session)
    );
    assert_eq!(
        scoped(&listed, "GET /and/:orgId"),
        k("where.AND.0.orgId", ScopeSource::Param)
    );
    for twin in [
        "GET /or",
        "GET /by-id/:id",
        "POST /create/:orgId",
        "GET /branch/:orgId",
    ] {
        assert_eq!(scoped(&listed, twin), vec![], "{twin}");
    }
}

/// Pins the Drizzle cases: `eq` of a table's column in a builder's `where`, in an
/// `and`, and in a relational query's `where`; the twin under `or` is not read.
#[test]
fn drizzle_conditions_under_a_tenant_column_are_scoped_queries() {
    let listed = server().listed().into_owned();
    let k = |s: ScopeSource| vec![("where.orgId".to_string(), s)];
    assert_eq!(scoped(&listed, "GET /drizzle"), k(ScopeSource::Session));
    assert_eq!(
        scoped(&listed, "GET /drizzle-and/:orgId"),
        k(ScopeSource::Param)
    );
    assert_eq!(
        scoped(&listed, "GET /drizzle-query"),
        k(ScopeSource::Session)
    );
    assert_eq!(scoped(&listed, "GET /drizzle-or"), vec![]);
}

/// Pins what mining reads: the measured copy holds no scoped query, and no filter
/// value of the new readings (the `AND` item, the Drizzle column).
#[test]
fn the_measured_copy_holds_none_of_it() {
    let measured = server();
    let file = measured
        .files
        .iter()
        .find(|f| f.path == "src/server.ts")
        .expect("scanned");
    for s in &file.symbols {
        assert!(s.scoped_queries.is_empty(), "{}", s.name);
        for c in &s.controls {
            assert!(
                !c.starts_with(drift_core::controls::FILTER_VALUE)
                    || (!c.contains("where.AND.0") && !c.contains(".where\twhere.orgId")),
                "{} {c}",
                s.name
            );
            assert_ne!(c, drift_core::controls::UNREAD_RESPONDS, "{}", s.name);
        }
    }
}

/// Pins the reading of unrecorded calls: a handler whose only such call writes
/// the response says so; one that also hands the rows to a method of a value no
/// import names does not.
#[test]
fn a_body_whose_unrecorded_calls_respond_says_so() {
    let listed = server().listed().into_owned();
    let unread = drift_core::controls::UNREAD_CALL;
    let responds = drift_core::controls::UNREAD_RESPONDS;
    assert!(has_control(&listed, "GET /mine", unread));
    assert!(has_control(&listed, "GET /mine", responds));
    assert!(has_control(&listed, "GET /elsewhere", unread));
    assert!(!has_control(&listed, "GET /elsewhere", responds));
}
