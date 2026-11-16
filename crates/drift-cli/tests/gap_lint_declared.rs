//! Rules a team already wrote in its linter configuration, read beyond JSON
//! `overrides`: an ESLint flat config's block scoped by `files`, ruff's banned API and
//! relative-import ban, and import-linter contracts. Each is listed by `drift census
//! --from-map` with the file and line that declare it; what Drift can check exactly is
//! proposed (declared, proposed, advise, shown to no agent), the rest is listed with
//! why; a configuration built by code Drift does not read proposes nothing. Every name
//! is invented.

use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_EXPERIMENTAL")
        .env_remove("GITHUB_STEP_SUMMARY")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    assert!(
        out.status.code().is_some_and(|c| c <= 1),
        "{args:?} failed:\n{stdout}\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    stdout
}

/// `drift census --from-map --json`'s declared entries.
fn declared(root: &Path) -> Vec<Value> {
    let out = drift(root, &["--no-cache", "census", "--json", "--from-map"]);
    let v: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}\n{out}"));
    v["from_map"]
        .as_array()
        .expect("a from_map array")
        .iter()
        .filter(|e| e["kind"] == "declared")
        .cloned()
        .collect()
}

fn proposed(entries: &[Value]) -> Vec<&Value> {
    entries.iter().filter(|e| e["proposed"] == true).collect()
}

/// The `reason` of each note that is not expressed, sorted.
fn reasons(entries: &[Value]) -> Vec<String> {
    let mut r: Vec<String> = entries
        .iter()
        .filter(|e| e["note"] == "not_expressed")
        .map(|e| e["reason"].as_str().unwrap_or_default().to_string())
        .collect();
    r.sort();
    r
}

/// `core/` (sixteen TypeScript files importing each other) below `ui/` (three files
/// importing `core/`), as `s31_from_map` builds it, with `config` as
/// `eslint.config.mjs`.
fn ts_layered(config: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"demo\" }");
    for i in 0..16 {
        let next = (i + 1) % 16;
        write(
            r,
            &format!("core/part{i}.ts"),
            &format!(
                "import {{ part{next} }} from \"./part{next}\";\n\nexport function part{i}() {{\n  return part{next}();\n}}\n"
            ),
        );
    }
    for n in ["home", "list", "detail"] {
        write(
            r,
            &format!("ui/{n}.ts"),
            &format!(
                "import {{ part0 }} from \"../core/part0\";\n\nexport function {n}() {{\n  return part0();\n}}\n"
            ),
        );
    }
    write(r, "eslint.config.mjs", config);
    dir
}

const FLAT: &str = r#"import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["../ui/**"] }],
    },
  },
]);
"#;

/// Pins the flat config end to end: the block scoped to `core/` is proposed with the
/// line that declares it; accepted, a new import against it is reported. Before, a
/// JavaScript configuration's scoped blocks were not read at all, so nothing was
/// proposed.
#[test]
fn a_flat_config_block_is_proposed_accepted_and_checked() {
    let dir = ts_layered(FLAT);
    let r = dir.path();
    let entries = declared(r);
    let p = proposed(&entries);
    assert_eq!(p.len(), 1, "{entries:#?}");
    let p = p[0];
    assert_eq!(p["convention"]["rule"]["signal"], "import:ui", "{p:#}");
    assert_eq!(p["declared"]["at"][0], "eslint.config.mjs:7", "{p:#}");
    assert_eq!(p["declared"]["configs"][0], "eslint.config.mjs", "{p:#}");
    assert_eq!(
        (p["follows"].as_u64(), p["differ"].as_u64()),
        (Some(16), Some(0))
    );
    assert_eq!(p["convention"]["status"], "proposed");
    assert_eq!(p["convention"]["mode"], "advise");
    assert!(
        p["convention"].get("agents").is_none_or(Value::is_null),
        "{p:#}"
    );
    let text = drift(r, &["--no-cache", "census", "--from-map"]);
    assert!(text.contains("declared in eslint.config.mjs:7"), "{text}");
    assert!(text.contains("before it writes the import"), "{text}");

    let id = p["id"].as_str().unwrap().to_string();
    drift(r, &["--no-cache", "init"]);
    drift(r, &["--no-cache", "review", "--accept", &id]);
    write(
        r,
        "core/bad.ts",
        "import { home } from \"../ui/home\";\n\nexport function bad() {\n  return home();\n}\n",
    );
    let out = drift(r, &["--no-cache", "check", "--format", "json"]);
    let report: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}\n{out}"));
    let new: Vec<&Value> = report["violations"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|v| v["id"] == id.as_str() && v["baselined"] != true)
                .collect()
        })
        .unwrap_or_default();
    assert_eq!(new.len(), 1, "{report:#}");
    assert!(new[0].to_string().contains("core/bad.ts"), "{:#}", new[0]);
}

/// Pins that a configuration built by code Drift does not read proposes nothing and is
/// listed as such: the same block handed to a function imported from another file.
#[test]
fn a_computed_config_proposes_nothing() {
    let built = FLAT
        .replace(
            "import { defineConfig } from \"eslint/config\";",
            "import { make } from \"./make.mjs\";",
        )
        .replace("defineConfig([", "[make(")
        .replace("]);", ")];");
    let dir = ts_layered(&built);
    let entries = declared(dir.path());
    assert!(proposed(&entries).is_empty(), "{entries:#?}");
    assert_eq!(reasons(&entries), ["computed"], "{entries:#?}");
}

const PYPROJECT: &str = r#"[project]
name = "demo"
version = "0.1.0"

[tool.ruff.lint]
select = ["E", "F", "TID"]

[tool.ruff.lint.flake8-tidy-imports]
ban-relative-imports = "parents"

[tool.ruff.lint.flake8-tidy-imports.banned-api]
"requests".msg = "Use httpx."

[tool.importlinter]
root_packages = ["core", "ui"]

[[tool.importlinter.contracts]]
name = "The core does not use the screens"
type = "forbidden"
source_modules = ["core"]
forbidden_modules = ["ui"]
allow_indirect_imports = true

[[tool.importlinter.contracts]]
name = "Layers"
type = "layers"
layers = ["ui", "core"]
"#;

/// The Python fixture: `core/` (sixteen modules importing each other) below `ui/`
/// (three importing `core`), with `PYPROJECT`.
fn py_layered() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", PYPROJECT);
    write(r, "core/__init__.py", "");
    write(r, "ui/__init__.py", "");
    for i in 0..16 {
        let next = (i + 1) % 16;
        write(
            r,
            &format!("core/part{i}.py"),
            &format!(
                "from core.part{next} import part{next}\n\n\ndef part{i}():\n    return part{next}()\n"
            ),
        );
    }
    for n in ["home", "list", "detail"] {
        write(
            r,
            &format!("ui/{n}.py"),
            &format!("from core.part0 import part0\n\n\ndef {n}():\n    return part0()\n"),
        );
    }
    dir
}

/// Pins the Python linters: an import-linter `forbidden` contract that allows
/// indirect imports is proposed as the layering rule, with its line; a banned package
/// outside the repository, a relative-import ban and a `layers` contract (which
/// forbids indirect imports too) are listed with why and not proposed. Before, Python
/// linter configurations were not read at all.
#[test]
fn python_linter_settings_are_listed_and_the_exact_one_proposed() {
    let dir = py_layered();
    let entries = declared(dir.path());
    let p = proposed(&entries);
    assert_eq!(p.len(), 1, "{entries:#?}");
    let p = p[0];
    assert_eq!(p["convention"]["rule"]["signal"], "import:ui", "{p:#}");
    assert_eq!(p["declared"]["at"][0], "pyproject.toml:17", "{p:#}");
    assert_eq!(p["follows"].as_u64(), Some(17), "{p:#}");
    assert_eq!(
        reasons(&entries),
        ["indirect", "package", "relative"],
        "{entries:#?}"
    );
    let text = drift(dir.path(), &["--no-cache", "census", "--from-map"]);
    assert!(
        text.contains("pyproject.toml:12"),
        "the banned package, by line: {text}"
    );
}
