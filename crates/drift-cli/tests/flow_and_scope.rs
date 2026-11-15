//! Three readings that say what a repository does by what its code does, with no
//! list of names behind them:
//!
//! - an operation is *fed by a parameter* where the value it is given is read off a
//!   parameter of its function, and each call on the way from the entry point
//!   handed on a value read off a parameter: what the request sent may reach it. An
//!   operation given a constant or a setting is not;
//! - a function that reads a request and answers it, and that no listed entry point
//!   reaches, is said to be not listed, whatever serves it;
//! - where most entry points that query one thing give the query a value of the
//!   caller under one key, the ones that query it and give it none are listed.

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

fn inventory(root: &Path) -> Value {
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
    serde_json::from_slice(&out.stdout).unwrap()
}

/// Whether the route reaches an operation of `kind`, and whether that is fed.
fn reach(inv: &Value, route: &str, kind: &str) -> Option<bool> {
    inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["route"] == route)
        .unwrap_or_else(|| panic!("no route {route}: {inv:#}"))["reaches"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|r| r["kind"] == kind)
        .map(|r| r["fed"] == true)
}

const PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"pg\": \"8.11.0\", \"@prisma/client\": \"5.20.0\" } }\n";

#[test]
fn an_operation_is_fed_where_what_the_request_sent_reaches_it() {
    let dir = write(&[
        ("package.json", PACKAGE),
        (
            "src/store.ts",
            r#"import { Pool } from "pg";
const pool = new Pool();

export function byName(name: string) {
  return pool.query(`SELECT * FROM users WHERE name = '${name}'`);
}

export function byTable(table: string) {
  return pool.query(`SELECT * FROM ${table} WHERE active = true`);
}
"#,
        ),
        (
            "src/login.ts",
            r#"import { Pool } from "pg";
const pool = new Pool();

export function login() {
  return (req: any, res: any) => {
    pool
      .query(`SELECT * FROM users WHERE email = '${req.body.email}'`)
      .then((rows: any) => res.json(rows));
  };
}
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { Pool } from "pg";
import { byName, byTable } from "./store";
import { login } from "./login";

const pool = new Pool();
const app = express();

app.get("/direct", async (req, res) => {
  res.json(await pool.query(`SELECT * FROM users WHERE id = '${req.query.id}'`));
});

app.get("/through-a-local", async (req, res) => {
  const wanted = req.query.id;
  const sql = "SELECT * FROM users WHERE id = '" + wanted + "'";
  res.json(await pool.query(sql));
});

app.get("/handed-on", async (req, res) => {
  res.json(await byName(String(req.query.name)));
});

app.get("/not-handed-on", async (req, res) => {
  const table = process.env.USERS_TABLE as string;
  res.json(await byTable(table));
});

app.get("/setting", async (req, res) => {
  const table = process.env.USERS_TABLE as string;
  res.json(await pool.query("SELECT * FROM " + table + " WHERE active = true"));
});

app.post("/made", login());
"#,
        ),
    ]);
    let inv = inventory(dir.path());
    let kind = "sql_string_interpolation";
    for route in ["/direct", "/through-a-local", "/handed-on", "/made"] {
        assert_eq!(reach(&inv, route, kind), Some(true), "{route}");
    }
    // Reached, and given nothing of what the request sent.
    for route in ["/not-handed-on", "/setting"] {
        assert_ne!(reach(&inv, route, kind), Some(true), "{route}");
    }
}

#[test]
fn a_python_operation_is_fed_by_a_parameter_or_by_the_request() {
    let dir = write(&[
        ("requirements.txt", "flask\n"),
        ("shop/__init__.py", ""),
        (
            "shop/app.py",
            r#"import os
import sqlite3

from flask import Flask, request

app = Flask(__name__)


def find(name):
    cursor = sqlite3.connect("d").cursor()
    return cursor.execute(f"SELECT * FROM users WHERE name = '{name}'").fetchall()


@app.route("/direct")
def direct():
    wanted = request.args["name"]
    cursor = sqlite3.connect("d").cursor()
    return str(cursor.execute(f"SELECT * FROM users WHERE name = '{wanted}'").fetchall())


@app.route("/handed-on/<name>")
def handed_on(name):
    return str(find(name))


@app.route("/setting")
def setting():
    return str(find(os.environ["DEFAULT_USER"]))
"#,
        ),
    ]);
    let inv = inventory(dir.path());
    let kind = "sql_string_interpolation";
    assert_eq!(reach(&inv, "/direct", kind), Some(true));
    assert_eq!(reach(&inv, "/handed-on/<name>", kind), Some(true));
    assert_eq!(reach(&inv, "/setting", kind), Some(false));
}

#[test]
fn a_function_that_answers_requests_and_nothing_reaches_is_said_to_be_unlisted() {
    let dir = write(&[
        ("package.json", PACKAGE),
        // Registered by a framework Drift has no adapter for: nothing lists it.
        (
            "src/handlers/export.ts",
            "export async function exportAll(req: any, res: any) {\n  const format = req.query.format;\n  res.status(200).json({ format });\n}\n",
        ),
        // A handler a listed route names is reached, and is no news.
        (
            "src/handlers/list.ts",
            "export async function list(req: any, res: any) {\n  res.status(200).json({ q: req.query.q });\n}\n",
        ),
        (
            "src/server.ts",
            "import express from \"express\";\nimport { list } from \"./handlers/list\";\n\nconst app = express();\napp.get(\"/items\", list);\n",
        ),
    ]);
    let inv = inventory(dir.path());
    let unlisted: Vec<(String, String)> = inv["unlisted"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|u| {
            (
                u["path"].as_str().unwrap_or_default().to_string(),
                u["symbol"].as_str().unwrap_or_default().to_string(),
            )
        })
        .collect();
    assert_eq!(
        unlisted,
        [(
            "src/handlers/export.ts".to_string(),
            "exportAll".to_string()
        )],
        "{inv:#}"
    );
}

#[test]
fn what_most_entry_points_scope_to_the_caller_lists_the_ones_that_do_not() {
    let mut server = String::from(
        r#"import express from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const app = express();
function requireUser(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: "unauthenticated" });
  req.user = decode(req.headers.authorization);
  next();
}
"#,
    );
    for i in 0..5 {
        server += &format!(
            "app.get(\"/notes/mine{i}\", requireUser, async (req, res) => {{\n  res.json(await prisma.note.findMany({{ where: {{ userId: req.user.id, kind: {i} }} }}));\n}});\n"
        );
    }
    // Queries the same thing by an id the request names, and gives it nothing of
    // the caller.
    server += "app.get(\"/notes/:id\", requireUser, async (req, res) => {\n  res.json(await prisma.note.findUnique({ where: { id: req.params.id } }));\n});\n";
    // Another thing, queried once: nothing is learned of it.
    server += "app.get(\"/tags\", requireUser, async (req, res) => {\n  res.json(await prisma.tag.findMany({ where: { active: true } }));\n});\n";
    let dir = write(&[("package.json", PACKAGE), ("src/server.ts", &server)]);
    let inv = inventory(dir.path());
    let gaps = inv["scope_gaps"].as_array().cloned().unwrap_or_default();
    assert_eq!(gaps.len(), 1, "{inv:#}");
    let gap = &gaps[0];
    assert!(
        gap["resource"].as_str().unwrap().ends_with("prisma.note"),
        "{gap:#}"
    );
    assert_eq!(gap["key"], "where.userId");
    assert_eq!(
        (gap["scoped"].as_u64(), gap["members"].as_u64()),
        (Some(5), Some(6))
    );
    let exceptions: Vec<&str> = gap["exceptions"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["route"].as_str())
        .collect();
    assert_eq!(exceptions, ["/notes/:id"]);
}
