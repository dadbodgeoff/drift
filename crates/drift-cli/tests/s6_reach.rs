//! What an entry point reaches (stream S6 of the build from the audits):
//!
//! - A route whose handler is what a call builds, handed to a wrapper
//!   (`app.get(path, asyncHandler(searchProducts()))`), reaches what that call
//!   makes, and that handler is not in `unlisted`. A factory's result given to
//!   `use` (`app.use("/ftp/:file", servePublicFiles())`) is a mount whatever its
//!   path: no fact says whether what it makes is a router, a middleware or a
//!   handler, so it is no route (review R3, F3), and a handler it makes stays in
//!   `unlisted`, said not read.
//! - `fed` follows the value: an operation is fed by the request only when the
//!   parameter its operand is read off is the one each call on the way passes. A
//!   parameter with a default the caller does not pass carries nothing, unless the
//!   default is read off one it passes (`url = req.query.u`: F3).
//! - A `$where` built in a function of the body and given to a query is the
//!   query's, fed where the text is read off what the route passed.

use std::fs;
use std::path::Path;

use drift_core::RepoFacts;
use drift_mine::security::{EntryRow, Inventory, inventory};

fn write(root: &Path, files: &[(&str, &str)]) {
    for (path, text) in files {
        let p = root.join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
}

fn ts(files: &[(&str, &str)]) -> (RepoFacts, Inventory) {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), files);
    let (facts, _) = drift_ts::scan(
        dir.path(),
        &drift_ts::ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap();
    let inv = inventory(&facts);
    (facts, inv)
}

fn entry<'a>(inv: &'a Inventory, symbol: &str) -> &'a EntryRow {
    inv.entry_points
        .iter()
        .find(|e| e.symbol == symbol)
        .unwrap_or_else(|| {
            let names: Vec<&str> = inv.entry_points.iter().map(|e| e.symbol.as_str()).collect();
            panic!("no entry point {symbol}: {names:?}")
        })
}

/// (kind, fed) of each reach of the entry point.
fn reaches(inv: &Inventory, symbol: &str) -> Vec<(String, bool)> {
    entry(inv, symbol)
        .reaches
        .iter()
        .map(|r| (r.kind.clone(), r.fed))
        .collect()
}

fn unlisted(inv: &Inventory) -> Vec<String> {
    inv.unlisted.iter().map(|u| u.symbol.clone()).collect()
}

const PKG: (&str, &str) = (
    "package.json",
    r#"{ "name": "shop", "dependencies": { "express": "4.19.2" } }"#,
);

const UTILS: (&str, &str) = (
    "lib/utils.ts",
    r#"export function asyncHandler(fn: any) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
"#,
);

const DB: (&str, &str) = ("lib/db.ts", "export const db: any = {};\n");

const SEARCH: (&str, &str) = (
    "routes/search.ts",
    r#"import { db } from "../lib/db";
export function searchProducts() {
  return (req: any, res: any) => {
    const q = req.query.q;
    db.query(`SELECT * FROM Products WHERE name LIKE '%${q}%'`).then((rows: any) => res.json(rows));
  };
}
"#,
);

const FILES: (&str, &str) = (
    "routes/fileServer.ts",
    r#"import path from "path";
export function servePublicFiles() {
  return (req: any, res: any) => {
    const file = req.params.file;
    res.sendFile(path.resolve("ftp/", file));
  };
}
"#,
);

/// Pins gap 5 of the security audit: before, the route's only call was
/// `lib/utils.ts#asyncHandler()(ref)`, so it reached nothing and
/// `searchProducts` was in `unlisted`. The `use` with a parameterised path stays
/// no entry point (F3: the `ALL` route S6 listed for it was a guess), and
/// `servePublicFiles` stays in `unlisted`: not read, never an unguarded route.
#[test]
fn a_handler_a_call_builds_behind_a_wrapper_or_a_use_is_reached() {
    let (_, inv) = ts(&[
        PKG,
        UTILS,
        DB,
        SEARCH,
        FILES,
        (
            "server.ts",
            r#"import express from "express";
import * as utils from "./lib/utils";
import { searchProducts } from "./routes/search";
import { servePublicFiles } from "./routes/fileServer";
const app = express();
app.get("/rest/products/search", utils.asyncHandler(searchProducts()));
app.use("/ftp/:file", servePublicFiles());
app.listen(3000);
"#,
        ),
    ]);
    assert!(
        reaches(&inv, "GET /rest/products/search")
            .iter()
            .any(|(k, _)| k == "sql_string_interpolation"),
        "{:?}",
        reaches(&inv, "GET /rest/products/search")
    );
    assert!(
        !inv.entry_points
            .iter()
            .any(|e| e.symbol.starts_with("ALL /ftp")),
        "{:?}",
        inv.entry_points
            .iter()
            .map(|e| &e.symbol)
            .collect::<Vec<_>>()
    );
    let left = unlisted(&inv);
    assert!(!left.contains(&"searchProducts".to_string()), "{left:?}");
    assert!(left.contains(&"servePublicFiles".to_string()), "{left:?}");
}

/// A `use` under a prefix with no parameter mounts, and is listed as no route: a
/// factory there may build a router.
#[test]
fn a_factory_used_under_a_plain_prefix_is_no_route() {
    let (_, inv) = ts(&[
        PKG,
        FILES,
        (
            "server.ts",
            r#"import express from "express";
import { servePublicFiles } from "./routes/fileServer";
const app = express();
app.use("/ftp", servePublicFiles());
app.listen(3000);
"#,
        ),
    ]);
    assert!(
        !inv.entry_points
            .iter()
            .any(|e| e.symbol.starts_with("ALL /ftp")),
        "{:?}",
        inv.entry_points
            .iter()
            .map(|e| &e.symbol)
            .collect::<Vec<_>>()
    );
}

/// Pins gap 6: before, `POST /a` reached `dynamic_fetch` fed, because every
/// call on the way handed on some value read off a parameter, though the address
/// is a parameter with a default that no caller passes. `POST /b` passes the
/// address and stays fed.
#[test]
fn fed_follows_the_parameter_that_carries_the_request() {
    let (_, inv) = ts(&[
        PKG,
        (
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
        ),
        (
            "lib/solve.ts",
            r#"import { notify } from "./webhook";
export async function solve(challenge: any, score: number) {
  await notify(challenge, score);
}
"#,
        ),
        (
            "server.ts",
            r#"import express from "express";
import { solve } from "./lib/solve";
import { forward } from "./lib/webhook";
const app = express();
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
        ),
    ]);
    assert_eq!(
        reaches(&inv, "POST /a"),
        [("dynamic_fetch".to_string(), false)]
    );
    assert_eq!(
        reaches(&inv, "POST /b"),
        [("dynamic_fetch".to_string(), true)]
    );
}

/// Pins NodeGoat's `$where` built in a helper (audit unit 8): before, the query
/// `col.find(criteria())` was no sink at all, since the `$where` is written in
/// what `criteria` returns, not in what `find` is given.
#[test]
fn a_where_built_in_a_function_of_the_body_is_the_querys() {
    let (_, inv) = ts(&[
        PKG,
        DB,
        (
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
        ),
        (
            "server.ts",
            r#"import express from "express";
import { db } from "./lib/db";
import { byThreshold } from "./lib/dao";
const app = express();
app.get("/allocations/:id", (req: any, res: any) => {
  res.json(byThreshold(db.allocations, req.params.id, req.query.threshold));
});
app.listen(3000);
"#,
        ),
    ]);
    assert_eq!(
        reaches(&inv, "GET /allocations/:id"),
        [("nosql_injection".to_string(), true)]
    );
}
