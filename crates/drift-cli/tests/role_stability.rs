//! Hysteresis through the CLI (round 9, D): after `drift review --accept`, a one-file
//! change that would have mining propose a parent role's card in place of the accepted
//! child's leaves the accepted card in `drift init` and `drift census`, and proposes no
//! new id for the rule.

use std::path::Path;
use std::process::{Command, Output};

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

fn run(root: &Path, args: &[&str]) -> Output {
    Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap()
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = run(root, args);
    assert!(out.status.success(), "{args:?} failed: {out:?}");
    String::from_utf8(out.stdout).unwrap()
}

/// A class in `rel`, `depth` folders below the root, extending `Base` or not.
fn class(root: &Path, rel: &str, name: &str, follows: bool) {
    let depth = rel.matches('/').count();
    let up = "../".repeat(depth);
    let body = if follows {
        format!(
            "import {{ Base }} from \"{up}lib/base\";\n\nexport class {name} extends Base {{}}\n"
        )
    } else {
        format!("export class {name} {{}}\n")
    };
    write(root, rel, &body);
}

/// `src/feat/**` 39 of 40 extend `Base`, `src/other/**` 16 of 20, 60 plain classes
/// under `lib/`: mining proposes the child, `src/feat/**`.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(r, "lib/base.ts", "export class Base {}\n");
    for i in 0..40 {
        class(
            r,
            &format!("src/feat/g{}/f{i}.ts", i % 4),
            &format!("Feat{i}"),
            i != 0,
        );
    }
    for i in 0..20 {
        class(
            r,
            &format!("src/other/o{i}.ts"),
            &format!("Other{i}"),
            i >= 4,
        );
    }
    for i in 0..60 {
        class(r, &format!("lib/l{i:02}.ts"), &format!("Lib{i}"), false);
    }
    dir
}

/// The ids of the "extend `Base`" proposals in `census --json`, with their role's dir.
fn extends_base(root: &Path) -> Vec<(String, String)> {
    let census: serde_json::Value =
        serde_json::from_str(&drift(root, &["census", "--json", "--all"])).unwrap();
    census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| {
            p["rule"]["type"] == "wrapped_by"
                && p["rule"]["any_of"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|t| t == "lib/base.ts#Base"))
        })
        .map(|p| {
            (
                p["id"].as_str().unwrap().to_string(),
                p["role"]["dir"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

fn policy_ids(root: &Path) -> String {
    std::fs::read_to_string(root.join(".drift/conventions.yaml")).unwrap()
}

#[test]
fn an_accepted_card_survives_a_one_file_change() {
    let dir = repo();
    let r = dir.path();
    let first = extends_base(r);
    assert_eq!(first.len(), 1, "{first:?}");
    assert_eq!(first[0].1, "src/feat");
    let child = first[0].0.clone();

    // Without a policy, the one-file change swaps the child for the parent.
    let probe = repo();
    class(probe.path(), "src/feat/g1/new.ts", "NewFeat", false);
    let swapped = extends_base(probe.path());
    assert_eq!(swapped.len(), 1, "{swapped:?}");
    assert_eq!(swapped[0].1, "src");
    let parent = swapped[0].0.clone();
    assert_ne!(parent, child);

    // With the child accepted, it stays, and the parent is not proposed.
    drift(r, &["init"]);
    drift(r, &["review", "--accept", &child]);
    class(r, "src/feat/g1/new.ts", "NewFeat", false);
    assert_eq!(extends_base(r), [(child.clone(), "src/feat".to_string())]);
    drift(r, &["init"]);
    let policy = policy_ids(r);
    assert!(policy.contains(&child), "{policy}");
    assert!(!policy.contains(&parent), "{policy}");
    // The accepted card's evidence is refreshed: 39 of 41.
    let check: serde_json::Value =
        serde_json::from_str(&drift(r, &["check", "--format", "json"])).unwrap();
    let flagged: Vec<&str> = check["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["id"] == child.as_str() && v["baselined"] == false)
        .map(|v| v["symbol"].as_str().unwrap())
        .collect();
    assert_eq!(flagged, ["NewFeat"], "{check}");
    assert!(check["violations"][0]["evidence"] == "39/41", "{check}");
}
