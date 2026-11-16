//! Readings a review of the listed reading found to credit what it cannot prove,
//! or to say `none` where it stopped reading (stream F9). Each test says what it
//! pins; each fails on the code before the fix.
//!
//! - A header compared with an environment value refuses (`refuses_secret:`)
//!   only where the branch it takes on a mismatch refuses as the lowering reads a
//!   refusal: a branch that answers with data, or a `throw` this function's own
//!   `try` catches, is no refusal.
//! - Input handed by a spread is handed (`input_handed:`), and input handed past
//!   the cap of callees kept is said to be (`input_handed:unresolved:..`), so the
//!   validation reading says unknown, never "nothing validates it".

use std::fs;
use std::path::Path;

use drift_core::{FileFacts, RepoFacts, Symbol, controls};
use drift_ts::{ScanOptions, scan};

const PACKAGE: &str =
    r#"{ "name": "api", "dependencies": { "express": "4.19.2", "left-pad": "1.3.0" } }"#;

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

fn file<'a>(r: &'a RepoFacts, path: &str) -> &'a FileFacts {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
}

fn symbol<'a>(f: &'a FileFacts, name: &str) -> &'a Symbol {
    f.symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| {
            let names: Vec<&str> = f.symbols.iter().map(|s| s.name.as_str()).collect();
            panic!("{name} not in {}: {names:?}", f.path)
        })
}

fn has(s: &Symbol, control: &str) -> bool {
    s.controls.iter().any(|c| c == control)
}

fn has_prefix(s: &Symbol, prefix: &str) -> bool {
    s.controls.iter().any(|c| c.starts_with(prefix))
}

const SECRETS: &str = r#"
declare const published: unknown;
declare const drafts: unknown;

export function serves(req: any, res: any) {
  if (req.get("x-preview-key") !== process.env.PREVIEW_KEY) {
    return res.json(published);
  }
  return res.json(drafts);
}

export function caught(req: any, res: any) {
  try {
    if (req.get("x-preview-key") !== process.env.PREVIEW_KEY) {
      throw new Error("denied");
    }
  } catch (e) {
    return res.json(published);
  }
  return res.json(drafts);
}

export function thrown(req: any, res: any) {
  if (req.get("x-preview-key") !== process.env.PREVIEW_KEY) {
    throw new Error("denied");
  }
  return res.json(drafts);
}

export function refuses(req: any, res: any) {
  if (req.get("x-preview-key") !== process.env.PREVIEW_KEY) {
    return res.status(401).end();
  }
  return res.json(drafts);
}
"#;

/// Pins: a secret mismatch whose branch answers with data (`return
/// res.json(published)`) answers every caller and was read as a refusal
/// (`refuses_secret:`, then `service_auth`); so was a `throw` the function's own
/// `try` catches and answers with data. Neither is a refusal now. A `throw` no
/// `try` here catches, and a 401, still are.
#[test]
fn a_secret_branch_that_serves_refuses_no_one() {
    let r = repo(&[("package.json", PACKAGE), ("src/preview.ts", SECRETS)]);
    let listed = r.listed();
    let f = file(&listed, "src/preview.ts");
    let secret = format!("{}x-preview-key", controls::REFUSES_SECRET);
    for name in ["serves", "caught"] {
        let s = symbol(f, name);
        assert!(
            !has_prefix(s, controls::REFUSES_SECRET),
            "{name}: {:?}",
            s.controls
        );
    }
    for name in ["thrown", "refuses"] {
        let s = symbol(f, name);
        assert!(has(s, &secret), "{name}: {:?}", s.controls);
    }
}

const SPREAD: &str = r#"
import express from "express";
import pad from "left-pad";

const app = express();

export function spreadArgs(req: any, res: any) {
  const out = pad(...req.body.parts);
  res.json({ out });
}

export function spreadObject(req: any, res: any) {
  const out = pad({ ...req.body });
  res.json({ out });
}

app.post("/a", spreadArgs);
app.post("/b", spreadObject);
"#;

/// Pins: input handed to a package's call by a spread (`pad(...req.body.parts)`,
/// `pad({ ...req.body })`) was not seen as handed, so the unit read "reads
/// input, nothing validates it". It is `input_handed:<callee>` now.
#[test]
fn input_handed_by_a_spread_is_handed() {
    let r = repo(&[("package.json", PACKAGE), ("src/app.ts", SPREAD)]);
    let listed = r.listed();
    let f = file(&listed, "src/app.ts");
    for name in ["spreadArgs", "spreadObject"] {
        let s = symbol(f, name);
        assert!(
            s.controls
                .iter()
                .any(|c| c.starts_with(controls::INPUT_HANDED) && c.contains("pkg:left-pad")),
            "{name}: {:?}",
            s.controls
        );
    }
}

/// Pins: past the cap of callees kept (16), a call handed the input was dropped
/// and the unit could read "nothing validates it". The lowering now says a call
/// was handed it that it did not keep (`input_handed:unresolved:handed_unread`).
/// A body under the cap does not say so.
#[test]
fn input_handed_past_the_cap_is_unread() {
    let mut text = String::from(
        "import * as lp from \"left-pad\";\n\nexport function many(req: any, res: any) {\n",
    );
    for i in 0..20 {
        text.push_str(&format!("  lp.f{i}(req.body);\n"));
    }
    text.push_str("  res.json({});\n}\n\nexport function few(req: any, res: any) {\n  lp.g(req.body);\n  res.json({});\n}\n");
    let r = repo(&[("package.json", PACKAGE), ("src/many.ts", &text)]);
    let listed = r.listed();
    let f = file(&listed, "src/many.ts");
    let marker = format!("{}unresolved:handed_unread", controls::INPUT_HANDED);
    let many = symbol(f, "many");
    assert!(has(many, &marker), "{:?}", many.controls);
    let few = symbol(f, "few");
    assert!(!has(few, &marker), "{:?}", few.controls);
    // Mining reads what the measured build read.
    let measured = symbol(file(&r, "src/many.ts"), "many");
    assert!(!has(measured, &marker));
}
