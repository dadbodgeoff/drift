//! `drift census --why`: the miner's funnel made visible (stream S12, audit 7 gap G2).
//! On a synthetic repository with invented names: routes in one folder that all use the
//! repository's own wrapper (a rule that holds 12 of 12, dropped at `universal`), and
//! routes in another that mostly use another one (10 of 13, dropped at `wilson`).
//!
//! What it pins: before S12 no flag listed which candidates a gate dropped (only counts,
//! behind `DRIFT_FUNNEL`), so `--why` did not exist and these tests fail; and the record
//! changes nothing that `census` prints without it.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

const SIGNED: &str = "import { withSession } from \"@/lib/session\";\n\nexport const GET = withSession(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const GATED: &str = "import { withBadge } from \"@/lib/badge\";\n\nexport const GET = withBadge(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const PLAIN: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"heronry\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/session.ts",
        "export function withSession<T>(h: T): T {\n  return h;\n}\n",
    );
    write(
        r,
        "lib/badge.ts",
        "export function withBadge<T>(h: T): T {\n  return h;\n}\n",
    );
    // 12 of 12: universal in its folder.
    for i in 0..12 {
        write(r, &format!("app/nests/n{i:02}/route.ts"), SIGNED);
    }
    // 10 of 13: Wilson lower bound 0.497, under 0.75.
    for i in 0..13 {
        write(
            r,
            &format!("app/perches/p{i:02}/route.ts"),
            if i < 10 { GATED } else { PLAIN },
        );
    }
    // Helpers, so a wrapper is rare among functions at large (lift).
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    dir
}

fn run(bin: &str, root: &Path, args: &[&str]) -> std::process::Output {
    Command::new(bin)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_FUNNEL")
        .output()
        .unwrap()
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = run(&BIN, root, args);
    assert!(
        out.status.success(),
        "{args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn rows<'v>(v: &'v Value, gate: &str) -> Vec<&'v Value> {
    v["dropped"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["gate"] == gate)
        .collect()
}

/// The record observes only: `census` prints exactly what it printed before (the same
/// text before and after a `--why` run, and, when `DRIFT_BEFORE_BIN` names the binary
/// from before this stream, the same text as that binary), and its JSON is the same.
#[test]
fn census_without_why_is_unchanged() {
    let dir = repo();
    let r = dir.path();
    let before = drift(r, &["census"]);
    let json_before = drift(r, &["census", "--json"]);
    let _ = drift(r, &["census", "--why"]);
    let _ = drift(r, &["census", "--why", "--json"]);
    assert_eq!(before, drift(r, &["census"]), "--why changes no later census");
    assert_eq!(json_before, drift(r, &["census", "--json"]));
    assert!(!before.contains("What mining dropped"), "{before}");
    // No cap cut a default-tier rule here, so no cap note.
    assert!(!before.contains("because of mining's caps"), "{before}");
    if let Ok(old) = std::env::var("DRIFT_BEFORE_BIN") {
        let out = run(&old, r, &["census"]);
        assert!(out.status.success());
        assert_eq!(
            String::from_utf8(out.stdout).unwrap(),
            before,
            "census prints what the binary before S12 printed"
        );
    }
}

#[test]
fn why_lists_a_universal_and_a_below_bound_rule_under_their_gates() {
    let dir = repo();
    let r = dir.path();
    let v: Value = serde_json::from_str(&drift(r, &["census", "--why", "--json"])).unwrap();
    assert_eq!(v["observation_only"], true);

    // 12 of 12 on the nests' routes: dropped at `universal`, the repository's own wrapper.
    let universal = rows(&v, "universal");
    let nest = universal
        .iter()
        .find(|d| {
            d["rule"].as_str().unwrap().contains("withSession")
                && d["role"].as_str().unwrap().contains("app/nests/**")
        })
        .unwrap_or_else(|| panic!("no universal withSession row: {v:#}"));
    assert_eq!(nest["holders"], 12);
    assert_eq!(nest["members"], 12);
    assert_eq!(nest["value"], 1.0);
    assert_eq!(nest["target"], "repository");
    assert_eq!(nest["detail"], "holds for all 12 of 12: no outlier");

    // 10 of 13 on the perches' routes: dropped at `wilson`, lower bound 0.497 under 0.75.
    let wilson = rows(&v, "wilson");
    let perch = wilson
        .iter()
        .find(|d| {
            d["rule"].as_str().unwrap().contains("withBadge")
                && d["role"].as_str().unwrap().contains("app/perches/**")
        })
        .unwrap_or_else(|| panic!("no wilson withBadge row: {v:#}"));
    assert_eq!(perch["holders"], 10);
    assert_eq!(perch["members"], 13);
    assert_eq!(perch["value"], 0.497);
    assert_eq!(perch["threshold"], 0.75);
    assert_eq!(perch["detail"], "lower bound 0.50 under 0.75");
    assert_eq!(perch["target"], "repository");
    // Neither is listed under the other gate.
    assert!(
        !wilson
            .iter()
            .any(|d| d["rule"].as_str().unwrap().contains("withSession")
                && d["role"].as_str().unwrap().contains("app/nests/**"))
    );

    // Every gate is documented with its constant and origin; the counts are the rows'.
    let gates = v["gates"].as_array().unwrap();
    let g = |name: &str| gates.iter().find(|g| g["name"] == name).unwrap();
    assert_eq!(g("universal")["origin"], "engineering, no study");
    assert_eq!(g("wilson")["dropped"].as_u64().unwrap(), wilson.len() as u64);
    assert!(
        g("wilson")["constant"]
            .as_str()
            .unwrap()
            .contains("MIN_LOWER_BOUND = 0.75")
    );
    assert!(v["reached"]["observed"].as_u64().unwrap() >= 2);

    // `--why <gate>` narrows to one gate.
    let only: Value =
        serde_json::from_str(&drift(r, &["census", "--why", "universal", "--json"])).unwrap();
    let dropped = only["dropped"].as_array().unwrap();
    assert!(!dropped.is_empty());
    assert!(dropped.iter().all(|d| d["gate"] == "universal"));
    assert_eq!(only["gates"].as_array().unwrap().len(), 1);

    // The text view: per gate, then the candidates, strongest first.
    let text = drift(r, &["census", "--why"]);
    assert!(text.starts_with("What mining dropped, gate by gate."), "{text}");
    assert!(text.contains("\nuniversal: "), "{text}");
    assert!(
        text.lines().any(|l| l.starts_with("  12 of 12  ")
            && l.contains("app/nests/**")
            && l.contains("withSession")
            && l.contains("holds for all 12 of 12")
            && l.contains("target defined in the repository")),
        "{text}"
    );
    assert!(
        text.lines().any(|l| l.starts_with("  10 of 13  ")
            && l.contains("app/perches/**")
            && l.contains("lower bound 0.50 under 0.75")),
        "{text}"
    );

    // An unknown gate is refused, naming the gates.
    let out = run(&BIN, r, &["census", "--why", "nosuch"]);
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("universal"));
}
