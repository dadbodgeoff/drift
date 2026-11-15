//! `drift census --json`: shape, agreement with the text output, determinism and
//! freedom from side effects.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

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

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 0..40 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 37 { GUARDED } else { UNGUARDED },
        );
    }
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    dir
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(out.status.success(), "{args:?} failed");
    String::from_utf8(out.stdout).unwrap()
}

#[test]
fn census_json_matches_text_and_has_the_documented_shape() {
    let dir = repo();
    let r = dir.path();
    let raw = drift(r, &["census", "--json"]);
    assert!(
        !r.join(".drift").exists(),
        "census --json writes no files (not even the fact cache)"
    );
    assert_eq!(raw, drift(r, &["census", "--json"]), "deterministic");

    let v: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["schema"], 1);
    assert!(v["engine"].as_str().unwrap().starts_with("drift "));
    assert!(v["units"].as_u64().unwrap() >= 40);
    assert!(v["roles"].as_u64().unwrap() > 0);
    assert_eq!(v["params"]["max"], 15);
    assert_eq!(v["params"]["min_block_role_size"], 15);
    let proposals = v["proposals"].as_array().unwrap();
    assert_eq!(v["conventions"].as_u64().unwrap() as usize, proposals.len());
    assert_eq!(v["shown"], v["conventions"], "no --tier filter");

    let p = proposals
        .iter()
        .find(|p| p["summary"].as_str().unwrap().contains("withAuth"))
        .expect("withAuth convention");
    assert_eq!(p["rule"]["type"], "wrapped_by");
    assert_eq!(p["rule"]["kind"], "call");
    assert_eq!(p["rule"]["any_of"][0], "lib/auth.ts#withAuth");
    assert_eq!(p["role"]["entry"], "http");
    assert_eq!(p["role"]["members"], 40);
    assert_eq!(p["evidence"]["holders"], 37);
    assert_eq!(p["evidence"]["total"], 40);
    assert_eq!(p["blockable"], true);
    assert_eq!(p["tier"], "default", "a call wrapper in a role of 40");
    assert_eq!(p["rule_kind"], "wrapped_by:call");
    assert_eq!(p["tier_reason"], Value::Null, "default tier: no reason");
    assert_eq!(p["language"], "ts");
    assert!(
        p["evidence"].get("python_members").is_none(),
        "no Python member"
    );
    assert_eq!(p["names_package"], false);
    assert_eq!(v["params"]["tier"]["target"], "in_repo");
    assert_eq!(v["params"]["tier"]["decision"], "D7");
    assert_eq!(
        v["params"]["tier"]["default_rule_kinds"],
        serde_json::json!(["wrapped_by:call", "avoids:import"])
    );
    assert_eq!(
        v["params"]["tier"]["advise_only_languages"],
        serde_json::json!(["py"])
    );
    // Every proposal says why it is not default tier, and the reason agrees with the tier.
    for q in proposals {
        match q["tier_reason"].as_str() {
            None => {
                assert_eq!(q["tier_reason"], Value::Null, "{q}");
                assert_eq!(q["tier"], "default", "{q}");
                assert_eq!(q["names_package"], false, "{q}");
            }
            Some(code) => {
                assert!(
                    [
                        "language_advise",
                        "rule_kind_d7",
                        "rule_kind",
                        "names_package",
                        "small_role"
                    ]
                    .contains(&code),
                    "{q}"
                );
                assert_eq!(q["tier"], "suggestion", "{q}");
                if code == "names_package" {
                    assert_eq!(q["names_package"], true, "{q}");
                }
            }
        }
    }
    assert_eq!(
        v["tiers"]["default"].as_u64().unwrap() + v["tiers"]["suggestion"].as_u64().unwrap(),
        proposals.len() as u64
    );
    assert!(
        p["example"]["path"]
            .as_str()
            .unwrap()
            .starts_with("app/api/r")
    );
    assert_eq!(p["example"]["symbol"], "GET");
    assert_eq!(p["example"]["line"], 3);
    assert_eq!(p["outliers_total"], 3);
    assert_eq!(p["outliers"].as_array().unwrap().len(), 3, "all outliers");
    assert_eq!(p["outliers"][0]["path"], "app/api/r37/route.ts");
    assert_eq!(p["outliers"][0]["line"], 1);

    // Same ids, summaries and order as the text output.
    let text = drift(r, &["census"]);
    let from_text: Vec<String> = text
        .lines()
        .filter_map(|l| l.trim_start().split_once(". [").map(|(_, rest)| rest))
        .map(|rest| rest.replacen("] ", " ", 1))
        .collect();
    let from_json: Vec<String> = proposals
        .iter()
        .enumerate()
        .map(|(i, p)| {
            assert_eq!(p["rank"].as_u64().unwrap() as usize, i + 1);
            format!(
                "{} {}",
                p["id"].as_str().unwrap(),
                p["summary"].as_str().unwrap()
            )
        })
        .collect();
    assert_eq!(from_text, from_json);
}

/// With no conventions, `census --json` names the largest role it saw (as the text
/// output's reason does); with conventions, `largest_role` is null.
#[test]
fn census_json_names_the_largest_role_when_nothing_is_proposed() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    for i in 0..6 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    let v: Value = serde_json::from_str(&drift(r, &["census", "--json"])).unwrap();
    assert_eq!(v["proposals"].as_array().unwrap().len(), 0, "{v}");
    let l = &v["largest_role"];
    assert_eq!(l["members"], 6, "{v}");
    assert_eq!(l["role"]["dir"], "lib", "{v}");
    assert!(l["summary"].as_str().unwrap().contains("lib"), "{v}");
    let text = drift(r, &["census"]);
    assert!(
        text.contains("the largest role here has 6 members"),
        "{text}"
    );

    let full = repo();
    let v: Value = serde_json::from_str(&drift(full.path(), &["census", "--json"])).unwrap();
    assert!(!v["proposals"].as_array().unwrap().is_empty());
    assert!(v["largest_role"].is_null(), "{v}");
}
