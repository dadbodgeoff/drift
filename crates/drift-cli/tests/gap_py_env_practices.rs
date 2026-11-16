//! `drift practices --json`, config concern: a read through django-environ or
//! environs is a unit of the concern, under the library's env schema, never a read
//! of `os.environ` in place (Python lowering 75). Before, only the call that built
//! the reader (`env = Env()`) was in the concern, and the reads were not.

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

const DJANGO_ENVIRON: &str = r#"import environ

env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env()
SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env.bool("DEBUG")
DATABASES = {"default": env.db("DATABASE_URL")}
"#;

const ENVIRONS: &str = r#"from environs import Env

env = Env()
env.read_env()
API_TOKEN = env("API_TOKEN")
PORT = env.int("PORT", 8000)


def redis():
    return env.str("REDIS_URL")
"#;

const OS_ENVIRON: &str = r#"import os

A = os.environ.get("A_VAR")
B = os.environ["B_VAR"]
"#;

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "requirements.txt", "django-environ\nenvirons\n");
    write(r, "app/__init__.py", "");
    write(r, "app/dj.py", DJANGO_ENVIRON);
    write(r, "app/envs.py", ENVIRONS);
    write(r, "app/osenv.py", OS_ENVIRON);
    dir
}

fn config_concern(root: &Path) -> Value {
    let out = Command::new(&*BIN)
        .args(["--no-cache", "practices", "--all", "--json"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(out.status.success(), "{out:?}");
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "config")
        .cloned()
        .expect("the config concern")
}

/// The variant of `key`, its members and the symbols of its examples.
fn variant(concern: &Value, key: &str) -> (u64, Vec<(String, String)>) {
    let v = concern["variants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["key"] == key)
        .unwrap_or_else(|| panic!("no variant {key}: {concern:#}"));
    let examples = v["examples"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["path"].as_str().unwrap().to_string(),
                e["symbol"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    (v["members"].as_u64().unwrap(), examples)
}

#[test]
fn library_reads_are_the_config_concern_under_their_env_schema() {
    let dir = repo();
    let concern = config_concern(dir.path());
    // django-environ: its three reads (the reader's construction is no read).
    let (members, examples) = variant(&concern, "env_schema:environ");
    assert_eq!(members, 3, "{concern:#}");
    assert!(
        examples.iter().all(|(p, _)| p == "app/dj.py")
            && examples.iter().any(|(_, s)| s == "SECRET_KEY"),
        "{examples:?}"
    );
    // environs: the three reads, and the construction it had before.
    let (members, examples) = variant(&concern, "env_schema:environs");
    assert_eq!(members, 4, "{concern:#}");
    assert!(
        examples.iter().all(|(p, _)| p == "app/envs.py"),
        "{examples:?}"
    );
    // `os.environ` read in place is as it was.
    let (members, _) = variant(&concern, "in_place:os.environ");
    assert_eq!(members, 2, "{concern:#}");
    // No read through a library is said to be read in place.
    for v in concern["variants"].as_array().unwrap() {
        let key = v["key"].as_str().unwrap();
        assert!(
            !key.contains("in_place:environ") && !key.contains("in_place:environs"),
            "{key}"
        );
    }
    assert_eq!(concern["population"]["unknown"], 0, "{concern:#}");
}
