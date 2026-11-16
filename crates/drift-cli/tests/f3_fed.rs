//! `fed` by argument position never says "not fed" of an argument it did not read
//! (F3, review R3 rows 2 and 3).
//!
//! - `mass_assignment` and `nosql_injection` are judged by what any argument holds
//!   (`Object.assign({}, req.body)`), not by the first argument: before, the first
//!   argument `{}` read no parameter, so the sink read not fed.
//! - A parameter whose default is read off another (`url = req.query.u`) holds what
//!   that one holds where the caller leaves it out: before, `f(req)` carried `#0`
//!   only and the fetch, at `#1`, read not fed.
//! - A function called through `call` (`go.call(null, req)`), whose arguments are
//!   not at their own positions, is read as the whole call was: fed.

use std::fs;
use std::path::Path;

use drift_mine::security::{Inventory, inventory};

fn write(root: &Path, files: &[(&str, &str)]) {
    for (path, text) in files {
        let p = root.join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
}

fn ts(files: &[(&str, &str)]) -> Inventory {
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
    inventory(&facts)
}

/// (kind, fed) of each reach of the entry point.
fn reaches(inv: &Inventory, symbol: &str) -> Vec<(String, bool)> {
    let e = inv
        .entry_points
        .iter()
        .find(|e| e.symbol == symbol)
        .unwrap_or_else(|| {
            let names: Vec<&str> = inv.entry_points.iter().map(|e| e.symbol.as_str()).collect();
            panic!("no entry point {symbol}: {names:?}")
        });
    e.reaches.iter().map(|r| (r.kind.clone(), r.fed)).collect()
}

const PKG: (&str, &str) = (
    "package.json",
    r#"{ "name": "shop", "dependencies": { "express": "4.19.2" } }"#,
);

#[test]
fn an_assignment_from_the_request_is_fed_whatever_its_first_argument() {
    let inv = ts(&[
        PKG,
        (
            "lib/save.ts",
            r#"export function save(id: string, req: any) {
  const row: any = { id };
  Object.assign(row, req.body);
  return row;
}
"#,
        ),
        (
            "server.ts",
            r#"import express from "express";
import { save } from "./lib/save";
const app = express();
app.post("/here", (req: any, res: any) => {
  const u = Object.assign({}, req.body);
  res.json(u);
});
app.post("/there/:id", (req: any, res: any) => {
  res.json(save(req.params.id, req));
});
app.listen(3000);
"#,
        ),
    ]);
    assert!(
        reaches(&inv, "POST /here").contains(&("mass_assignment".to_string(), true)),
        "{:?}",
        reaches(&inv, "POST /here")
    );
    assert!(
        reaches(&inv, "POST /there/:id").contains(&("mass_assignment".to_string(), true)),
        "{:?}",
        reaches(&inv, "POST /there/:id")
    );
}

#[test]
fn a_default_read_off_a_parameter_carries_what_that_one_carries() {
    let inv = ts(&[
        PKG,
        (
            "lib/go.ts",
            r#"export async function go(req: any, url = req.query.u) {
  await fetch(url);
}
"#,
        ),
        (
            "server.ts",
            r#"import express from "express";
import { go } from "./lib/go";
const app = express();
app.get("/go", async (req: any, res: any) => {
  await go(req);
  res.json({});
});
app.get("/through", async (req: any, res: any) => {
  await go.call(null, req);
  res.json({});
});
app.listen(3000);
"#,
        ),
    ]);
    assert_eq!(
        reaches(&inv, "GET /go"),
        [("dynamic_fetch".to_string(), true)]
    );
    // Reached through `call` only where the reading follows it there; where it
    // does, the answer is the whole call's.
    let through = reaches(&inv, "GET /through");
    assert!(
        through.iter().all(|(k, fed)| k != "dynamic_fetch" || *fed),
        "{through:?}"
    );
}
