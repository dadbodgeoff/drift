//! Review of PR 148, area 6, item 4: a `catch` that answers and then hands what it
//! caught to the framework's continuation (`res.status(500).json(...); next(e)`)
//! was recorded as `rethrow`, as if the framework's error handling answered; so was
//! one whose statement before `next(e)` is a helper that may answer
//! (`sendError(res, e); next(e)`). The listed reading now keeps what the clause
//! answered, and says `unread` where a statement before the hand-on is not read.
//! What mining reads is the measured build's reading, unchanged.

use std::fs;
use std::path::Path;

use drift_core::{RepoFacts, Symbol};
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

fn symbol<'a>(r: &'a RepoFacts, path: &str, name: &str) -> &'a Symbol {
    let f = r
        .files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"));
    f.symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name} not in {path}"))
}

fn does(s: &Symbol) -> Vec<String> {
    s.catches.iter().flat_map(|c| c.does.clone()).collect()
}

const ROUTES: &str = r#"import { sendError } from "./errors";

declare const store: any;

export const answered = async (req: any, res: any, next: any) => {
  try {
    res.json(await store.read(req.params.id));
  } catch (e) {
    res.status(500).json({ error: "failed" });
    next(e);
  }
};

export const helper = async (req: any, res: any, next: any) => {
  try {
    res.json(await store.read(req.params.id));
  } catch (e) {
    sendError(res, e);
    return next(e);
  }
};

export const logged = async (req: any, res: any, next: any) => {
  try {
    res.json(await store.read(req.params.id));
  } catch (e) {
    console.error(e);
    const at = "read";
    next(e);
  }
};
"#;

const ERRORS: &str = r#"export function sendError(res: any, e: unknown) {
  res.status(500).json({ error: String(e) });
}
"#;

#[test]
fn a_catch_that_answers_or_may_answer_before_next_is_no_rethrow() {
    let facts = repo(&[("routes/items.ts", ROUTES), ("routes/errors.ts", ERRORS)]);
    let listed = facts.listed();
    let at = "routes/items.ts";
    // It answered: the handler's answer, as the measured build read it.
    assert_eq!(does(symbol(&listed, at, "answered")), ["respond:500"]);
    // A helper handed the response first: not read, and no `return` served.
    assert_eq!(does(symbol(&listed, at, "helper")), ["unread"]);
    // A log line and a plain declaration answer nothing: the framework's.
    let logged = does(symbol(&listed, at, "logged"));
    assert!(logged.contains(&"rethrow".to_string()), "{logged:?}");
    // Mining's copy is the measured build's.
    assert_eq!(does(symbol(&facts, at, "answered")), ["respond:500"]);
    assert!(
        !does(symbol(&facts, at, "helper")).contains(&"unread".to_string()),
        "{:?}",
        does(symbol(&facts, at, "helper"))
    );
    assert!(
        !does(symbol(&facts, at, "logged")).contains(&"rethrow".to_string()),
        "{logged:?}"
    );
}
