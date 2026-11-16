//! SQL built from input reaches a query through a name as well as where it is
//! written (TypeScript lowering 76): text bound to a local first, text built by `+`,
//! text added to with `+=`. Text every interpolated part of which is a constant
//! interpolates no input. These are read by `drift security` and the practice map
//! ([`drift_core::Listed`]); what mining reads is what the measured build read.

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

fn sinks(r: &RepoFacts, symbol: &str) -> Vec<String> {
    r.files
        .iter()
        .find(|f| f.path == "src/db.ts")
        .expect("src/db.ts scanned")
        .symbols
        .iter()
        .find(|s| s.name == symbol)
        .unwrap_or_else(|| panic!("no symbol {symbol}"))
        .sinks
        .clone()
}

const PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"pg\": \"8.11.0\" } }\n";

const DB: &str = r#"import { Pool } from "pg";
const pool = new Pool();
const TABLE = "users";
const table = "users";
declare const sqlite: any;

export async function direct(id: string) {
  return pool.query(`SELECT * FROM users WHERE id = '${id}'`);
}

export async function throughLocal(id: string) {
  const q = `SELECT * FROM users WHERE id = '${id}'`;
  return pool.query(q);
}

export async function concatenated(id: string) {
  return pool.query("SELECT * FROM users WHERE id = '" + id + "'");
}

export async function concatenatedLocal(id: string) {
  const q = "SELECT * FROM users WHERE id = '" + id + "'";
  return pool.query(q);
}

export async function appended(owner: string) {
  let q = "SELECT * FROM users WHERE 1 = 1";
  if (owner) {
    q += " AND owner = '" + owner + "'";
  }
  return pool.query(q);
}

export async function reassigned(id: string) {
  let q;
  q = `DELETE FROM users WHERE id = ${id}`;
  return pool.query(q);
}

export async function sqliteAll(name: string) {
  return sqlite.all(`SELECT * FROM users WHERE name = '${name}'`);
}

export async function constantTable(id: string) {
  return pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
}

export async function screamingTable(id: string) {
  return pool.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
}

export async function configuredSchema(id: string) {
  return pool.query(`SELECT * FROM ${process.env.SCHEMA}.users WHERE id = $1`, [id]);
}

export async function placeholderList(ids: string[]) {
  return pool.query(`SELECT * FROM users WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(", ")})`, ids);
}

export async function quotedList(ids: string[]) {
  return pool.query(`SELECT * FROM users WHERE id IN (${ids.map((id) => `'${id}'`).join(", ")})`);
}

export async function numbered(page: string) {
  return pool.query(`SELECT * FROM users LIMIT 10 OFFSET ${Number(page)}`);
}

export async function parameterised(id: string) {
  const q = "SELECT * FROM users WHERE id = $1";
  return pool.query(q, [id]);
}

export async function notSql(name: string) {
  const greeting = "hello " + name;
  return pool.query(greeting);
}
"#;

const HIT: &[&str] = &["sql_string_interpolation"];

#[test]
fn sql_built_from_input_is_read_through_a_name() {
    let r = repo(&[("package.json", PACKAGE), ("src/db.ts", DB)]);
    let listed = r.listed();
    for name in [
        "direct",
        "throughLocal",
        "concatenated",
        "concatenatedLocal",
        "appended",
        "reassigned",
        "sqliteAll",
        "quotedList",
    ] {
        assert_eq!(sinks(&listed, name), HIT, "{name}");
    }
}

#[test]
fn sql_that_interpolates_only_constants_is_no_interpolation() {
    let r = repo(&[("package.json", PACKAGE), ("src/db.ts", DB)]);
    let listed = r.listed();
    for name in [
        "constantTable",
        "screamingTable",
        "configuredSchema",
        "placeholderList",
        "numbered",
        "parameterised",
        "notSql",
    ] {
        assert!(sinks(&listed, name).is_empty(), "{name}");
    }
}

/// Mining's input is what the measured build read: SQL interpolated where the call
/// is written, whatever is interpolated, and nothing through a name.
#[test]
fn mining_reads_sql_sinks_as_the_measured_build_did() {
    let r = repo(&[("package.json", PACKAGE), ("src/db.ts", DB)]);
    for name in [
        "direct",
        "constantTable",
        "screamingTable",
        "configuredSchema",
        "placeholderList",
        "quotedList",
        "numbered",
    ] {
        assert_eq!(sinks(&r, name), HIT, "{name}");
    }
    for name in [
        "throughLocal",
        "concatenated",
        "concatenatedLocal",
        "appended",
        "reassigned",
        "sqliteAll",
        "parameterised",
        "notSql",
    ] {
        assert!(sinks(&r, name).is_empty(), "{name}");
    }
}
