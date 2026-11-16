//! Review fixes (PR 148, areas 3 and 5) for proposals from the map and guided setup.
//!
//! Pins:
//! - every way a person accepts a rule from the map records what breaks it at that
//!   moment in `drift.lock`, as accepting a mined convention keeps its outliers: the
//!   guided setup's yes, `drift review --accept` of a layering proposal (an import added
//!   since `drift init` included), and a hand edit repaired by `drift init`;
//! - a declared rule a person accepted is not proposed again as layering under another
//!   id once its breaks are fixed;
//! - `drift setup` honours `DRIFT_NO_FROM_MAP` as `drift init` does;
//! - a scripted guided setup whose named answer was not recorded exits 3 and says which
//!   (the security baseline through a link that leads outside the repository is not
//!   written);
//! - a mined card counts member lines of the lock, not fingerprint lines; an unreadable
//!   `.claude/settings.json` is not "already written";
//! - `--confirm` does not combine with `--yes-to`.

use std::path::Path;
use std::process::{Command, Stdio};

use drift_mine::policy::{ConventionsFile, Status};
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

fn read(r: &Path, rel: &str) -> String {
    std::fs::read_to_string(r.join(rel)).unwrap_or_default()
}

/// Runs drift with no fact cache and no agent's environment, standard input closed.
/// `person`: a script a person runs (`DRIFT_SETUP_PERSON=1`, no terminal witness).
fn run(root: &Path, args: &[&str], person: bool, env: &[(&str, &str)]) -> (i32, String, String) {
    let mut c = Command::new(&*BIN);
    c.arg("--no-cache")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_EXPERIMENTAL")
        .env_remove("DRIFT_NO_FROM_MAP")
        .env_remove("GITHUB_STEP_SUMMARY")
        .env_remove("CLAUDECODE")
        .env_remove("DRIFT_AGENT")
        .env_remove("DRIFT_SETUP_PERSON")
        .env_remove("DRIFT_SETUP_PERSON_NONINTERACTIVE");
    if person {
        c.env("DRIFT_SETUP_PERSON", "1")
            .env("DRIFT_SETUP_PERSON_NONINTERACTIVE", "1");
    }
    for (k, v) in env {
        c.env(k, v);
    }
    let out = c.output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn drift(root: &Path, args: &[&str]) -> String {
    let (code, out, err) = run(root, args, false, &[]);
    assert_eq!(code, 0, "{args:?} failed:\n{out}\n{err}");
    out
}

/// The lines of `drift.lock` for `id` (member lines only).
fn lock_lines(r: &Path, id: &str) -> Vec<String> {
    read(r, "drift.lock")
        .lines()
        .filter(|l| l.starts_with(&format!("{id} ")))
        .map(str::to_string)
        .collect()
}

/// The violations of `id` that `drift check` reports as new.
fn new_violations(r: &Path, id: &str) -> Vec<Value> {
    let out = drift(r, &["check", "--format", "json"]);
    let report: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}\n{out}"));
    report["violations"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|v| v["id"] == id && v["baselined"] != true)
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

fn from_map_id(r: &Path, kind: &str) -> String {
    ConventionsFile::load(r)
        .unwrap()
        .expect("a policy")
        .conventions
        .iter()
        .find(|c| c.from_map.as_deref() == Some(kind))
        .unwrap_or_else(|| panic!("no {kind} proposal"))
        .id
        .clone()
}

const BIOME: &str = r#"{
  "overrides": [
    {
      "includes": ["core/**/*.ts"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "warn",
              "options": {
                "patterns": [{ "group": ["../ui/screens/**"], "message": "core must not import ui." }]
              }
            }
          }
        }
      }
    }
  ]
}
"#;

const BAD: &str =
    "import { s0 } from \"../ui/screens/s0\";\n\nexport function bad() {\n  return s0();\n}\n";

/// `core/` (40 files importing each other) below `ui/screens/` (12 files importing
/// `core/`): `drift init` proposes the layering `core` never imports `ui/screens`.
/// With `biome`, `biome.json` declares the same restriction.
fn layered(biome: bool) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"demo\" }");
    for i in 0..40 {
        let n = (i + 1) % 40;
        write(
            r,
            &format!("core/c{i}.ts"),
            &format!(
                "import {{ c{n} }} from \"./c{n}\";\n\nexport function c{i}() {{\n  return c{n}();\n}}\n"
            ),
        );
    }
    for i in 0..12 {
        write(
            r,
            &format!("ui/screens/s{i}.tsx"),
            &format!(
                "import {{ c1 }} from \"../../core/c1\";\n\nexport function s{i}() {{\n  return c1();\n}}\n"
            ),
        );
    }
    if biome {
        write(r, "biome.json", BIOME);
    }
    dir
}

/// Area 3 item 1: a yes to a declared rule in `drift setup` records the file that
/// breaks it today, so `drift check` reports none as new. Before, setup only set the
/// status: the card promised "recorded in drift.lock" and the break was new.
#[test]
fn setup_accepting_a_declared_rule_records_its_breaks() {
    let dir = layered(true);
    let r = dir.path();
    write(r, "core/bad.ts", BAD);
    drift(r, &["init"]);
    let id = from_map_id(r, "declared");
    let (code, out, err) = run(r, &["setup", "--by", "person", "--yes-to", &id], true, &[]);
    assert_eq!(code, 0, "{out}\n{err}");
    let c = ConventionsFile::load(r).unwrap().unwrap();
    let c = c.conventions.iter().find(|c| c.id == id).unwrap();
    assert_eq!(c.status, Status::Accepted, "{out}");
    assert!(
        lock_lines(r, &id)
            .iter()
            .any(|l| l.starts_with(&format!("{id} core/bad.ts#"))),
        "{out}\n{}",
        read(r, "drift.lock")
    );
    assert!(new_violations(r, &id).is_empty(), "{out}");
}

/// Area 3 items 1 and 5: `drift review --accept` of a layering proposal records what
/// breaks it when it is accepted, an import added since `drift init` included, and the
/// interactive card is no longer read from the file. Before, nothing was recorded and
/// the import was a new violation on the next `drift check`.
#[test]
fn accepting_layering_records_an_import_added_since_init() {
    let dir = layered(false);
    let r = dir.path();
    drift(r, &["init"]);
    let id = from_map_id(r, "layering");
    write(r, "core/bad.ts", BAD);
    let (code, out, err) = run(r, &["review", "--accept", &id], false, &[]);
    assert_eq!(code, 0, "{out}\n{err}");
    assert!(
        lock_lines(r, &id)
            .iter()
            .any(|l| l.starts_with(&format!("{id} core/bad.ts#"))),
        "{out}\n{err}\n{}",
        read(r, "drift.lock")
    );
    assert!(err.contains("1 unit(s) that break it today"), "{err}");
    assert!(new_violations(r, &id).is_empty());
}

/// Area 3 item 1: a declared rule accepted by hand in the conventions file is
/// baselined by the next `drift init`, as a practice accepted by hand is. Before, only a
/// practice was, and the declared rule's breaks were reported as new.
#[test]
fn a_declared_rule_accepted_by_hand_is_baselined_by_init() {
    let dir = layered(true);
    let r = dir.path();
    write(r, "core/bad.ts", BAD);
    drift(r, &["init"]);
    let id = from_map_id(r, "declared");
    let mut p = ConventionsFile::load(r).unwrap().unwrap();
    p.get_mut(&id).unwrap().status = Status::Accepted;
    p.save(r).unwrap();
    assert!(lock_lines(r, &id).is_empty());
    drift(r, &["init"]);
    assert_eq!(lock_lines(r, &id).len(), 1, "{}", read(r, "drift.lock"));
    assert!(new_violations(r, &id).is_empty());
    // Once only: a break written after the repair is new.
    write(r, "core/bad2.ts", BAD);
    drift(r, &["init"]);
    assert_eq!(lock_lines(r, &id).len(), 1, "{}", read(r, "drift.lock"));
    assert_eq!(new_violations(r, &id).len(), 1);
}

/// Area 3 item 3: once the breaks of an accepted declared rule are fixed, `drift init`
/// does not propose the same restriction again as layering under another id. Before,
/// it did, and accepting both reported every violation twice.
#[test]
fn an_accepted_declared_rule_is_not_proposed_again_as_layering() {
    let dir = layered(true);
    let r = dir.path();
    write(r, "core/bad.ts", BAD);
    drift(r, &["init"]);
    let id = from_map_id(r, "declared");
    drift(r, &["review", "--accept", &id]);
    std::fs::remove_file(r.join("core/bad.ts")).unwrap();
    // The lock line of the fixed file goes; that is `drift check`'s business, not this.
    drift(r, &["init"]);
    let p = ConventionsFile::load(r).unwrap().unwrap();
    let again: Vec<&str> = p
        .conventions
        .iter()
        .filter(|c| c.id != id && c.from_map.is_some() && c.status == Status::Proposed)
        .map(|c| c.id.as_str())
        .collect();
    assert!(again.is_empty(), "proposed again: {again:?}");
}

/// Area 3 item 4: with `DRIFT_NO_FROM_MAP=1`, `drift setup` asks about no proposal
/// from the map, as `drift init` writes none. Before, it asked, and every yes ended in
/// "Not recorded".
#[test]
fn setup_honours_no_from_map() {
    let dir = layered(false);
    let r = dir.path();
    let (code, on, _) = run(r, &["setup"], false, &[]);
    assert_eq!(code, 0);
    assert!(on.contains("from the map, not mined"), "{on}");
    let (code, off, err) = run(r, &["setup"], false, &[("DRIFT_NO_FROM_MAP", "1")]);
    assert_eq!(code, 0, "{err}");
    assert!(!off.contains("from the map, not mined"), "{off}");
}

/// Area 5 items 6 and 7: a committed `.drift/security.lock` that links outside the
/// repository is not written through, and the scripted run that named `baseline` exits
/// 3 saying it was not recorded. Before, the yes wrote outside the repository, and a
/// named answer that was not recorded exited 0.
#[cfg(unix)]
#[test]
fn a_baseline_through_an_outside_link_is_not_written_and_the_run_fails() {
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("x");
    let dir = layered(false);
    let r = dir.path();
    std::fs::create_dir_all(r.join(".drift")).unwrap();
    std::os::unix::fs::symlink(&target, r.join(".drift/security.lock")).unwrap();
    let (code, out, err) = run(
        r,
        &["setup", "--by", "person", "--yes-to", "baseline"],
        true,
        &[],
    );
    assert!(!target.exists(), "written through the link:\n{out}");
    assert_eq!(code, 3, "{out}\n{err}");
    assert!(out.contains("-> not written"), "{out}");
    assert!(out.contains("Answered but not recorded: baseline"), "{out}");
}

/// Area 5 item 8: a mined card counts what `drift.lock` records of it by member line
/// (each outlier has a fingerprint line beside it), and an unreadable
/// `.claude/settings.json` is asked about, not taken as written already.
#[test]
fn the_cards_say_what_is_there() {
    const AUTH: &str = "type Handler = (req: Request) => Promise<Response>;\n\nexport function withAuth(h: Handler): Handler {\n  return async (req) => {\n    if (!req.headers.get(\"authorization\")) {\n      return new Response(\"Unauthorized\", { status: 401 });\n    }\n    return h(req);\n  };\n}\n";
    const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
    const UNGUARDED: &str =
        "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"demo\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(r, "lib/auth.ts", AUTH);
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i:02}() {{ return {i}; }}\n"),
        );
    }
    for i in 0..40 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 38 { GUARDED } else { UNGUARDED },
        );
    }
    write(r, ".claude/settings.json", "{ not json");
    drift(r, &["init"]);
    let lock = read(r, "drift.lock");
    assert!(lock.contains("#~ "), "fingerprint lines expected:\n{lock}");
    let out = drift(r, &["setup"]);
    assert!(
        out.contains("the 2 that differ today are in drift.lock already"),
        "{out}"
    );
    assert!(
        out.contains("Would ask: Add Drift's read-only lookups"),
        "{out}"
    );
}

/// Area 5 item 1: `--confirm` is a single step and does not combine with the guided
/// flow's `--yes-to`: refused, nothing changed.
#[test]
fn confirm_does_not_combine_with_yes_to() {
    let dir = layered(false);
    let r = dir.path();
    let (code, out, err) = run(
        r,
        &[
            "setup", "--by", "person", "--confirm", "S-x", "--yes-to", "baseline",
        ],
        true,
        &[],
    );
    assert_eq!(code, 2, "{out}\n{err}");
    assert!(err.contains("do not combine"), "{err}");
    assert!(!r.join(".drift").exists());
}
