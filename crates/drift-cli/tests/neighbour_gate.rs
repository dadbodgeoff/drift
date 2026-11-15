//! The neighbour gate in `drift check` (round 11, WS-J; off by default,
//! `DRIFT_NEIGHBOUR_GATE=on` turns it on): a new violation nearer a member a reviewer
//! marked fine than the convention's holders is held back, counted and listed
//! (`suppressed_neighbour`), never new. Golden `check --json` output, a single-file check (what the hooks run) and
//! the text report.

use std::path::Path;
use std::process::{Command, Output};

use serde_json::{Value, json};

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn run(root: &Path, args: &[&str], gate: Option<&str>) -> Output {
    let mut c = Command::new(&*BIN);
    c.args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_NEIGHBOUR_GATE");
    if let Some(g) = gate {
        c.env("DRIFT_NEIGHBOUR_GATE", g);
    }
    c.output().unwrap()
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = run(root, args, None);
    assert!(out.status.success(), "{args:?} failed: {out:?}");
    String::from_utf8(out.stdout).unwrap()
}

const TOOL_A: &str = "packages/core/src/tool-a.ts";
const TOOL_B: &str = "packages/core/src/tool-b.ts";
const LATE: &str = "packages/core/src/late.ts";
const TOOL: &str = "import { app } from '../../app/src/types';\nimport { args } from './cli-args';\nexport const tool = [app, args];\n";

/// `packages/core` does not import `packages/app` (a layering card, accepted). Its one
/// outlier at `init`, `tool-a.ts`, a CLI tool that reads `cli-args.ts`, is marked fine.
/// Then two new outliers: `tool-b.ts`, the same kind of file as `tool-a.ts`, and
/// `late.ts`, which is like the holders but for its import of the app.
fn repo() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "root", "private": true, "workspaces": ["packages/*"] }"#,
    );
    write(r, "packages/core/package.json", r#"{ "name": "@x/core" }"#);
    write(r, "packages/app/package.json", r#"{ "name": "@x/app" }"#);
    write(r, "packages/app/src/types.ts", "export const app = 1;\n");
    for i in 0..30 {
        write(
            r,
            &format!("packages/app/src/x{i}.ts"),
            &format!("import {{ c{i} }} from '../../core/src/c{i}';\nexport const x{i} = c{i};\n"),
        );
    }
    for i in 0..60 {
        write(
            r,
            &format!("packages/core/src/c{i}.ts"),
            &format!("export const c{i} = {i};\n"),
        );
    }
    write(
        r,
        "packages/core/src/cli-args.ts",
        "export const args = 1;\n",
    );
    write(r, TOOL_A, TOOL);
    drift(r, &["init"]);
    let census: Value = serde_json::from_str(&drift(r, &["census", "--json"])).unwrap();
    let id = census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["rule"]["type"] == "avoids" && p["role"]["package"] == "packages/core")
        .unwrap_or_else(|| panic!("the layering card: {census}"))["id"]
        .as_str()
        .unwrap()
        .to_string();
    drift(r, &["review", "--accept", &id]);
    drift(
        r,
        &[
            "review",
            "--exempt",
            &id,
            "--member",
            &format!("{TOOL_A}#(file)"),
            "--reason",
            "a CLI tool, not core code",
        ],
    );
    write(r, TOOL_B, TOOL);
    write(
        r,
        LATE,
        "import { app } from '../../app/src/types';\nexport const late = app;\n",
    );
    (dir, id)
}

fn check_json(r: &Path, args: &[&str], gate: Option<&str>) -> Value {
    let mut a = vec!["check", "--format", "json"];
    a.extend_from_slice(args);
    let out = run(r, &a, gate);
    serde_json::from_slice(&out.stdout).unwrap_or_else(|e| panic!("{e}: {out:?}"))
}

fn new_paths(v: &Value) -> Vec<String> {
    v["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| {
            !x["baselined"].as_bool().unwrap()
                && !x["suppressed"].as_bool().unwrap()
                && x.get("unsure").is_none()
                && x.get("suppressed_neighbour").is_none()
        })
        .map(|x| x["path"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn check_json_lists_what_the_gate_held_back() {
    let (dir, id) = repo();
    let r = dir.path();
    let v = check_json(r, &[], Some("on"));
    // Golden: the one hold, with both neighbours.
    assert_eq!(
        v["suppressed_neighbour"],
        json!([{
            "id": id,
            "path": TOOL_B,
            "symbol": "(file)",
            "line": 1,
            "nearest_apart": format!("{TOOL_A}#(file)"),
            "apart_code": "reviewed",
            "apart_distance": 0.0,
            "nearest_holder": "packages/core/src/c30.ts#(file)",
            "holder_distance": 0.25,
        }]),
        "{v:#}"
    );
    // Kept in `violations`, marked; `late.ts` is like the holders: warned.
    let held: Vec<&Value> = v["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["suppressed_neighbour"] == true)
        .collect();
    assert_eq!(held.len(), 1, "{v:#}");
    assert_eq!(held[0]["path"], TOOL_B);
    assert_eq!(new_paths(&v), vec![LATE.to_string()], "{v:#}");
    // The reviewer's exception is listed as before.
    assert!(
        v["exempt"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["path"] == TOOL_A && e["code"] == "reviewed"),
        "{v:#}"
    );
}

#[test]
fn a_single_file_check_holds_back_too() {
    let (dir, _) = repo();
    let r = dir.path();
    let v = check_json(r, &[TOOL_B], Some("on"));
    assert_eq!(
        v["suppressed_neighbour"].as_array().map(Vec::len),
        Some(1),
        "{v:#}"
    );
    assert_eq!(v["suppressed_neighbour"][0]["path"], TOOL_B);
    assert!(new_paths(&v).is_empty(), "{v:#}");
}

#[test]
fn off_by_default_and_with_off() {
    let (dir, _) = repo();
    let r = dir.path();
    for gate in [None, Some("off")] {
        let v = check_json(r, &[], gate);
        assert!(v.get("suppressed_neighbour").is_none(), "{gate:?}: {v:#}");
        let mut paths = new_paths(&v);
        paths.sort();
        assert_eq!(
            paths,
            vec![LATE.to_string(), TOOL_B.to_string()],
            "{gate:?}: {v:#}"
        );
        assert!(
            v["violations"]
                .as_array()
                .unwrap()
                .iter()
                .all(|x| x.get("suppressed_neighbour").is_none())
        );
    }
}

#[test]
fn the_text_report_counts_and_lists_them() {
    let (dir, _) = repo();
    let r = dir.path();
    let out = run(r, &["check"], Some("on"));
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(
        text.contains("drift: 1 warning(s) held back by the neighbour gate"),
        "{text}"
    );
    assert!(
        text.contains("  held [")
            && text.contains(&format!(
                "{TOOL_B}:1 (file) (nearest set apart {TOOL_A}#(file), reviewed;"
            )),
        "{text}"
    );
    assert!(text.contains("drift: 1 new violation(s)"), "{text}");
}
