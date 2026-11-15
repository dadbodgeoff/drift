//! SQL built from a part that is no literal reaches a query through a name as well
//! as where it is written (Python lowering 69): `q = f"SELECT ... '{name}'"`, then
//! `cursor.execute(q)`. Read by `drift security` and the practice map
//! (`RepoFacts::listed`); what mining reads is what the measured build read.

use std::path::Path;

use drift_core::RepoFacts;
use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn sinks(repo: &RepoFacts, symbol: &str) -> Vec<String> {
    let f = repo.files.iter().find(|f| f.path == "app/db.py").unwrap();
    f.symbols
        .iter()
        .find(|s| s.name == symbol)
        .unwrap_or_else(|| panic!("{symbol}"))
        .sinks
        .clone()
}

fn member_sinks(repo: &RepoFacts, class: &str, method: &str) -> Vec<String> {
    let f = repo.files.iter().find(|f| f.path == "app/db.py").unwrap();
    f.symbols
        .iter()
        .find(|s| s.name == class)
        .unwrap_or_else(|| panic!("{class}"))
        .members
        .iter()
        .find(|m| m.name == method)
        .unwrap_or_else(|| panic!("{class}.{method}"))
        .sinks
        .clone()
}

const DB: &str = r#"import sqlite3


def direct(name):
    c = sqlite3.connect("d").cursor()
    return c.execute(f"SELECT * FROM users WHERE name = '{name}'").fetchall()


def through_local(name):
    q = f"SELECT * FROM users WHERE name = '{name}'"
    c = sqlite3.connect("d").cursor()
    return c.execute(q).fetchall()


def concatenated_local(name):
    q = "SELECT * FROM users WHERE name = '" + name + "'"
    c = sqlite3.connect("d").cursor()
    return c.execute(q).fetchall()


def concatenated(name):
    c = sqlite3.connect("d").cursor()
    return c.execute("SELECT * FROM users WHERE name = '" + name + "'").fetchall()


def formatted_local(name):
    q = "SELECT * FROM users WHERE name = '{}'".format(name)
    c = sqlite3.connect("d").cursor()
    return c.execute(q).fetchall()


def appended(owner):
    q = "SELECT * FROM users WHERE 1 = 1"
    if owner:
        q += f" AND owner = '{owner}'"
    c = sqlite3.connect("d").cursor()
    return c.execute(q).fetchall()


def handed_on(name):
    built = f"SELECT * FROM users WHERE name = '{name}'"
    q = built
    c = sqlite3.connect("d").cursor()
    return c.execute(q).fetchall()


def parameterised(name):
    q = "SELECT * FROM users WHERE name = ?"
    c = sqlite3.connect("d").cursor()
    return c.execute(q, (name,)).fetchall()


def literal_appended(active):
    q = "SELECT * FROM users WHERE 1 = 1"
    if active:
        q += " AND active = 1"
    c = sqlite3.connect("d").cursor()
    return c.execute(q).fetchall()


def not_sql(name):
    q = f"hello {name}"
    c = sqlite3.connect("d").cursor()
    return c.execute(q).fetchall()


class Users:
    def find(self, name):
        q = f"SELECT * FROM users WHERE name = '{name}'"
        return self.cursor.execute(q).fetchall()
"#;

const HIT: &[&str] = &["sql_string_interpolation"];

fn repo() -> RepoFacts {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "requirements.txt", "flask\n");
    write(r, "app/__init__.py", "");
    write(r, "app/db.py", DB);
    scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0
}

#[test]
fn sql_built_from_input_is_read_through_a_name() {
    let r = repo();
    let listed = r.listed();
    for name in [
        "direct",
        "through_local",
        "concatenated",
        "concatenated_local",
        "formatted_local",
        "appended",
        "handed_on",
    ] {
        assert_eq!(sinks(&listed, name), HIT, "{name}");
    }
    assert_eq!(member_sinks(&listed, "Users", "find"), HIT);
    assert_eq!(sinks(&listed, "Users"), HIT);
    for name in ["parameterised", "literal_appended", "not_sql"] {
        assert!(sinks(&listed, name).is_empty(), "{name}");
    }
}

/// Mining's input is what the measured build read: the interpolation written
/// where the query is, and nothing through a name.
#[test]
fn mining_reads_sql_sinks_as_the_measured_build_did() {
    let r = repo();
    assert_eq!(sinks(&r, "direct"), HIT);
    for name in [
        "through_local",
        "concatenated",
        "concatenated_local",
        "formatted_local",
        "appended",
        "handed_on",
        "parameterised",
        "literal_appended",
        "not_sql",
        "Users",
    ] {
        assert!(sinks(&r, name).is_empty(), "{name}");
    }
    assert!(member_sinks(&r, "Users", "find").is_empty());
}
