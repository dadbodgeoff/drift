//! Rows sent back whole where other code withholds a field of them (TypeScript,
//! lowering 84).
//!
//! No field is sensitive by its name. A field is one the repository does not
//! send back where its own code takes it out before it answers: a query told to
//! leave it out (`omit`), a field taken apart from the rest and never read
//! (`const { passwordHash, ...safe } = user`), one deleted or blanked, and the
//! same done by a function the row is handed to (`toPublic(user)`). A body that
//! hands the whole of the same rows to a response, itself or through a function
//! that returns them whole, is listed with the fields it does not withhold.
//!
//! Not listed: a query that chooses its fields (`select`), a response built from
//! parts (`{ id: user.id }`), what a sanitising function gave, and rows nobody
//! withholds anything of.

use std::collections::BTreeMap;
use std::process::Command;
use std::sync::LazyLock;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: LazyLock<String> = LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const PACKAGE: &str = r#"{ "name": "ts10", "dependencies": { "express": "^4.19.0", "@prisma/client": "^5.0.0" } }
"#;

const DB: &str = r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#;

const USERS: &str = r#"import { prisma } from "./db";

export async function findUser(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function publicUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return null;
  const { passwordHash, resetToken: _resetToken, ...safe } = user;
  return safe;
}

export async function listed() {
  return prisma.user.findMany({ omit: { passwordHash: true } });
}

export function toPublic(user: any) {
  const { passwordHash, twoFactorSecret: _s, ...rest } = user;
  return rest;
}

export function scrub(user: any) {
  delete user.apiKey;
  return user;
}
"#;

const APP: &str = r#"import express from "express";
import { prisma } from "./db";
import { findUser, publicUser, listed } from "./users";

const app = express();

// Withheld: taken apart.
app.get("/users/:id", async (req, res) => {
  res.json(await publicUser(req.params.id));
});

// Withheld: left out by the call.
app.get("/users", async (_req, res) => {
  res.json(await listed());
});

// Whole: the row itself.
app.get("/profile/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  res.json(user);
});

// Whole: through a helper, inside an object.
app.get("/account/:id", async (req, res) => {
  const account = await findUser(req.params.id);
  res.status(200).json({ account });
});

// Whole rows of a list.
app.get("/admin/users", async (_req, res) => {
  const users = await prisma.user.findMany();
  res.send(users);
});

// Not whole: the call chooses its fields.
app.get("/names", async (_req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  res.json(users);
});

// Not whole: parts only.
app.get("/name/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  res.json({ id: user?.id, name: user?.name });
});

// Withheld here: deleted before it is sent.
app.get("/me/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  delete (user as any).passwordHash;
  res.json(user);
});

// Withheld here: blanked in a copy; the reset token still goes.
app.get("/copy/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  res.json({ ...user, passwordHash: undefined });
});

// Another model nobody withholds anything of.
app.get("/notes", async (_req, res) => {
  const notes = await prisma.note.findMany();
  res.json(notes);
});

export default app;

import { toPublic, scrub } from "./users";

// Withheld: by a helper handed the row.
app.get("/public/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  res.json(toPublic(user));
});

// Scrubbed in place by a helper, then sent.
app.get("/scrubbed/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  res.json(scrub(user));
});
"#;

fn drift(root: &std::path::Path, args: &[&str]) -> std::process::Output {
    Command::new(&*BIN)
        .arg("--root")
        .arg(root)
        .arg("--no-cache")
        .args(args)
        .output()
        .unwrap()
}

fn fixture() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join("src")).unwrap();
    for (name, text) in [
        ("package.json", PACKAGE),
        ("src/db.ts", DB),
        ("src/users.ts", USERS),
        ("src/app.ts", APP),
    ] {
        std::fs::write(root.join(name), text).unwrap();
    }
    dir
}

/// Each route listed, with the fields it does not withhold.
static FOUND: LazyLock<BTreeMap<String, Vec<String>>> = LazyLock::new(|| {
    let dir = fixture();
    let out = drift(dir.path(), &["security", "--json"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    v["whole_rows"]
        .as_array()
        .expect("whole_rows")
        .iter()
        .map(|w| {
            assert_eq!(w["rows"], "user", "{w}");
            (
                w["symbol"].as_str().unwrap().to_string(),
                w["fields"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|f| f.as_str().unwrap().to_string())
                    .collect(),
            )
        })
        .collect()
});

/// The fields a route is listed with; None where it is not listed.
fn fields(route: &str) -> Option<Vec<&'static str>> {
    FOUND
        .get(route)
        .map(|f| f.iter().map(String::as_str).collect())
}

const EVERY: [&str; 4] = ["apiKey", "passwordHash", "resetToken", "twoFactorSecret"];

#[test]
fn a_row_sent_whole_is_listed_with_every_field_other_code_withholds() {
    // The row itself, the rows of a list, and a row a function of the repository
    // returned whole, inside an object.
    for route in ["GET /profile/:id", "GET /admin/users", "GET /account/:id"] {
        assert_eq!(fields(route), Some(EVERY.to_vec()), "{route}");
    }
}

#[test]
fn a_field_the_body_withholds_itself_is_not_one_it_sends() {
    // Deleted before it is sent, blanked in a copy, left out by the query a
    // function ran: the password hash is withheld, the rest is not.
    for route in ["GET /me/:id", "GET /copy/:id", "GET /users"] {
        assert_eq!(
            fields(route),
            Some(vec!["apiKey", "resetToken", "twoFactorSecret"]),
            "{route}"
        );
    }
}

#[test]
fn what_is_chosen_built_from_parts_or_sanitised_is_not_whole() {
    for route in [
        // `select` chooses the fields.
        "GET /names",
        // Parts only.
        "GET /name/:id",
        // What a function that takes the fields apart gave.
        "GET /users/:id",
        "GET /public/:id",
        // Scrubbed by the function it was handed to.
        "GET /scrubbed/:id",
        // Rows nobody withholds anything of.
        "GET /notes",
    ] {
        assert!(
            !FOUND.contains_key(route),
            "{route}: {:?}",
            FOUND.get(route)
        );
    }
    assert_eq!(FOUND.len(), 6, "{:?}", *FOUND);
}

#[test]
fn a_row_sent_whole_is_a_finding_of_the_baseline() {
    let dir = fixture();
    let root = dir.path();
    let listed = drift(root, &["security"]);
    let said = String::from_utf8_lossy(&listed.stdout);
    assert!(
        said.contains("Rows sent back whole where other code withholds a field of them"),
        "{said}"
    );
    assert!(
        said.contains("GET /profile/:id sends user rows whole"),
        "{said}"
    );
    assert!(
        drift(root, &["security", "--write-baseline"])
            .status
            .success()
    );
    assert!(
        drift(root, &["security", "--ratchet", "--fail-on", "whole-row"])
            .status
            .success()
    );
    // One more route that sends the row whole.
    let more = format!(
        "{APP}\napp.get(\"/export/:id\", async (req, res) => {{\n  const user = await prisma.user.findUnique({{ where: {{ id: req.params.id }} }});\n  res.json(user);\n}});\n"
    );
    std::fs::write(root.join("src/app.ts"), more).unwrap();
    let added = drift(root, &["security", "--ratchet", "--fail-on", "whole-row"]);
    let said = String::from_utf8_lossy(&added.stdout);
    assert_eq!(added.status.code(), Some(1), "{said}");
    assert!(said.contains("GET /export/:id sends user whole"), "{said}");
}
