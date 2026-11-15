//! A check that refuses a caller unless a role or a comparison holds: `if not
//! caller.is_admin and row.owner_id != caller.id: abort(403)`, and the same written
//! `if not (caller.is_admin or row.owner_id == caller.id)`.
//!
//! Each half alone is an operand of an `and`, which decides only when the other
//! holds; read that way, the commonest owner check there is was found and never
//! proven. Together they decide every request: a caller with the role passes by the
//! role, and every other caller is compared with the row. So where the role is read
//! off the caller, the comparison is the route's check.
//!
//! Where the other operand is not the caller's role (a flag of the row, a value the
//! request sent), requests pass for a reason that is no authorization: the check
//! stays found, not proven.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

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

/// What the practice map says of the authorization of each route, by its path:
/// `known <mechanisms>`, `none`, or `unknown <reason> <obligation>`.
fn authz(root: &Path) -> BTreeMap<String, String> {
    let map = drift(root, &["practices", "--json", "--units"]);
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
                "unknown" => format!(
                    "unknown {} {}",
                    u["reason"].as_str().unwrap_or_default(),
                    u["not_proven"]["obligation"].as_str().unwrap_or_default()
                )
                .trim_end()
                .to_string(),
                other => other.to_string(),
            };
            (u["route"].as_str().unwrap_or_default().to_string(), said)
        })
        .collect()
}

const MODELS: &str = r#"from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Item(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer)
    is_public = db.Column(db.Boolean)
"#;

fn repo(views: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, body) in [
        ("requirements.txt", "flask\nflask-login\nflask-sqlalchemy\n"),
        ("shop/__init__.py", ""),
        ("shop/models.py", MODELS),
        ("shop/views.py", views),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    dir
}

const HEAD: &str = r#"from flask import Flask, abort, jsonify, request
from flask_login import current_user, login_required

from shop.models import Item

app = Flask(__name__)
"#;

#[test]
fn a_role_or_the_owner_is_the_routes_check() {
    let views = format!(
        r#"{HEAD}

@app.route("/and/<int:item_id>", methods=["DELETE"])
@login_required
def by_and(item_id):
    item = Item.query.get(item_id)
    if not current_user.is_admin and item.owner_id != current_user.id:
        abort(403)
    return jsonify(ok=True)


@app.route("/not-or/<int:item_id>", methods=["DELETE"])
@login_required
def by_not_or(item_id):
    item = Item.query.get(item_id)
    if not (current_user.is_admin or item.owner_id == current_user.id):
        abort(403)
    return jsonify(ok=True)


@app.route("/role-name/<int:item_id>", methods=["DELETE"])
@login_required
def by_role_name(item_id):
    item = Item.query.get(item_id)
    if current_user.role != "admin" and item.owner_id != current_user.id:
        abort(403)
    return jsonify(ok=True)


@app.route("/owner/<int:item_id>", methods=["DELETE"])
@login_required
def owner_alone(item_id):
    item = Item.query.get(item_id)
    if item.owner_id != current_user.id:
        abort(403)
    return jsonify(ok=True)
"#
    );
    let dir = repo(&views);
    let got = authz(dir.path());
    for route in [
        "/and/<int:item_id>",
        "/not-or/<int:item_id>",
        "/role-name/<int:item_id>",
        "/owner/<int:item_id>",
    ] {
        assert_eq!(got[route], "known owner_check", "{route}: {got:?}");
    }
}

#[test]
fn what_is_no_role_of_the_caller_proves_nothing() {
    let views = format!(
        r#"{HEAD}

@app.route("/row-flag/<int:item_id>")
@login_required
def row_flag(item_id):
    item = Item.query.get(item_id)
    if not item.is_public and item.owner_id != current_user.id:
        abort(403)
    return jsonify(ok=True)


@app.route("/sent/<int:item_id>")
@login_required
def sent(item_id):
    item = Item.query.get(item_id)
    if request.args.get("role") != "admin" and item.owner_id != current_user.id:
        abort(403)
    return jsonify(ok=True)


@app.route("/has-role/<int:item_id>")
@login_required
def has_role(item_id):
    item = Item.query.get(item_id)
    if current_user.is_admin and item.owner_id != current_user.id:
        abort(403)
    return jsonify(ok=True)


@app.route("/three/<int:item_id>")
@login_required
def three(item_id):
    item = Item.query.get(item_id)
    if not current_user.is_admin and item.owner_id != current_user.id and item.id > 10:
        abort(403)
    return jsonify(ok=True)
"#
    );
    let dir = repo(&views);
    let got = authz(dir.path());
    for route in [
        "/row-flag/<int:item_id>",
        "/sent/<int:item_id>",
        "/has-role/<int:item_id>",
        "/three/<int:item_id>",
    ] {
        assert!(got[route].starts_with("unknown"), "{route}: {}", got[route]);
    }
}

/// The same in TypeScript, where the caller is who the request holds
/// (`req.user`): a role of the caller's beside the comparison makes it the
/// route's check, a flag of the row does not.
#[test]
fn a_role_or_the_owner_in_typescript() {
    let dir = tempfile::tempdir().unwrap();
    for (rel, body) in [
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n",
        ),
        (
            "src/auth.ts",
            r#"import { Request, Response, NextFunction } from "express";

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.headers.authorization) {
    res.status(401).json({ error: "sign in" });
    return;
  }
  next();
}
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { requireUser } from "./auth";

declare const posts: { load(id: string): Promise<{ ownerId: string; isDraft: boolean }> };

const app = express();
app.use(requireUser);

app.delete("/and/:id", async (req: any, res) => {
  const post = await posts.load(req.params.id);
  if (!req.user.isAdmin && post.ownerId !== req.user.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  res.json({ ok: true });
});

app.delete("/not-or/:id", async (req: any, res) => {
  const post = await posts.load(req.params.id);
  if (!(req.user.role === "admin" || post.ownerId === req.user.id)) {
    return res.status(403).json({ error: "forbidden" });
  }
  res.json({ ok: true });
});

app.delete("/row-flag/:id", async (req: any, res) => {
  const post = await posts.load(req.params.id);
  if (!post.isDraft && post.ownerId !== req.user.id) {
    return res.status(403).json({ error: "forbidden" });
  }
  res.json({ ok: true });
});
"#,
        ),
    ] {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    let got = authz(dir.path());
    assert_eq!(got["/and/:id"], "known owner_check", "{got:?}");
    assert_eq!(got["/not-or/:id"], "known owner_check", "{got:?}");
    assert!(got["/row-flag/:id"].starts_with("unknown"), "{got:?}");
}
