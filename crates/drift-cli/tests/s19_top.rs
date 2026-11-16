//! `drift security --top [N]` and the first run's security part (stream S19).
//!
//! Pins: before, `drift security` had no ranked view and `drift init` said nothing of
//! what the inventory found but the baseline's count. Now both lead with the findings
//! to look at first, from the inventory's own facts, and change no exit code.

use std::path::Path;
use std::process::Command;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn drift(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// Three routes, none guarded: a `$where` built from the query (fed), an outgoing
/// request to an address the body sent (fed), and one to an address a default
/// parameter holds that no caller passes (not fed). The fixtures are those of
/// `s6_reach.rs`, whose readings that test pins.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "shop", "dependencies": { "express": "4.19.2" } }"#,
    );
    write(r, "lib/db.ts", "export const db: any = {};\n");
    write(
        r,
        "lib/dao.ts",
        r#"export function byThreshold(col: any, userId: string, threshold: string) {
  const criteria = () => {
    if (threshold) {
      return { $where: `this.userId == '${userId}' && this.stocks > '${threshold}'` };
    }
    return { userId };
  };
  return col.find(criteria());
}
"#,
    );
    write(
        r,
        "lib/webhook.ts",
        r#"export const notify = async (challenge: any, score = -1, webhook = process.env.HOOK) => {
  if (!webhook) {
    return;
  }
  await fetch(webhook, { method: "POST", body: JSON.stringify({ c: challenge.key, score }) });
};
export async function forward(url: string) {
  await fetch(url);
}
"#,
    );
    write(
        r,
        "lib/solve.ts",
        r#"import { notify } from "./webhook";
export async function solve(challenge: any, score: number) {
  await notify(challenge, score);
}
"#,
    );
    write(
        r,
        "server.ts",
        r#"import express from "express";
import { db } from "./lib/db";
import { byThreshold } from "./lib/dao";
import { solve } from "./lib/solve";
import { forward } from "./lib/webhook";
const app = express();
app.get("/allocations/:id", (req: any, res: any) => {
  res.json(byThreshold(db.allocations, req.params.id, req.query.threshold));
});
app.post("/a", async (req: any, res: any) => {
  await solve({ key: "k" }, req.body.score);
  res.json({});
});
app.post("/b", async (req: any, res: any) => {
  await forward(req.body.url);
  res.json({});
});
app.listen(3000);
"#,
    );
    dir
}

#[test]
fn top_ranks_what_the_request_reaches_and_counts_the_rest() {
    let dir = repo();
    let r = dir.path();
    let (code, out, err) = drift(r, &["security", "--top"]);
    assert_eq!(code, 0, "{err}");
    let one = out
        .lines()
        .position(|l| {
            l.starts_with("  1. A caller Drift found no guard for can send a value that is written into a MongoDB $where expression (nosql_injection): GET /allocations/:id (server.ts:")
        })
        .unwrap_or_else(|| panic!("{out}"));
    let two = out
        .lines()
        .position(|l| {
            l.starts_with("  2. A caller Drift found no guard for can send a value that becomes part of the address of a request the server makes (dynamic_fetch): POST /b (server.ts:")
        })
        .unwrap_or_else(|| panic!("{out}"));
    assert!(one < two, "{out}");
    assert!(!out.contains("POST /a"), "{out}");
    assert!(
        out.contains("  Not ranked: 1 where Drift read no request value reaching the operation."),
        "{out}"
    );

    let (code, out, err) = drift(r, &["security", "--top", "1"]);
    assert_eq!(code, 0, "{err}");
    assert!(!out.contains("\n  2. "), "{out}");
    assert!(
        out.contains("\n  1 more ranked: `drift security --top 2` lists them all;"),
        "{out}"
    );

    let (code, out, err) = drift(r, &["security", "--top", "1", "--json"]);
    assert_eq!(code, 0, "{err}");
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["top"]["shown"].as_array().map(Vec::len), Some(1), "{out}");
    assert_eq!(v["top"]["shown"][0]["kind"], "nosql_injection", "{out}");
    assert_eq!(v["top"]["more"], 1, "{out}");
    assert_eq!(v["top"]["not_ranked"]["not_fed"], 1, "{out}");
    assert!(
        v["entry_points"].is_array(),
        "the inventory is still all there"
    );
}

#[test]
fn the_first_run_shows_at_most_three_under_the_inventory_heading() {
    let dir = repo();
    let r = dir.path();
    let (code, out, err) = drift(r, &["init"]);
    assert_eq!(code, 0, "{err}");
    assert!(
        out.contains("\nFrom the security inventory (what Drift read; not conventions, and nothing here is checked)\n  1. A caller Drift found no guard for can send a value that is written into a MongoDB $where expression (nosql_injection)"),
        "{out}"
    );
    assert!(
        out.contains("`drift security --top` says why 1 more are not ranked; `drift security` lists every entry point and what it reaches."),
        "{out}"
    );
    assert!(!out.contains("\n  4. A caller"), "{out}");
}
