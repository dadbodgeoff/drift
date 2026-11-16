//! Two more sources of proposals from the map (stream S31), end to end:
//!
//! - a lint configuration that forbids a folder to import another is read, checked
//!   against the code and proposed at `drift init` as "declared in `biome.json`"
//!   (`from_map: declared`, proposed, advise, nothing in `drift.lock`); a configuration
//!   Drift cannot parse gives nothing;
//! - a wiring regularity the wiring miner computes is listed by `drift census
//!   --from-map` as information ("cannot be checked yet"), never written, with the
//!   registration sites Drift could not read counted as not read and the members they
//!   may register as unknown, never as unregistered.

use std::path::Path;
use std::process::{Command, Stdio};

use drift_mine::policy::{ConventionsFile, Mode, Status};
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
        out.status.success(),
        "{args:?} failed:\n{stdout}\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    stdout
}

/// `drift census --from-map --json`'s `from_map` entries.
fn from_map(root: &Path) -> Vec<Value> {
    let out = drift(root, &["--no-cache", "census", "--json", "--from-map"]);
    let v: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}\n{out}"));
    v["from_map"].as_array().expect("a from_map array").clone()
}

fn of_kind(entries: &[Value], kind: &str) -> Vec<Value> {
    entries
        .iter()
        .filter(|e| e["kind"] == kind)
        .cloned()
        .collect()
}

const BIOME: &str = r#"{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  // core is the lower layer
  "overrides": [
    {
      "includes": ["core/**/*.ts"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "patterns": [
                  { "group": ["../ui/**"], "message": "core must not import ui." }
                ]
              }
            }
          }
        }
      }
    }
  ]
}
"#;

/// `core/` (sixteen files importing each other) below `ui/` (three files importing
/// `core/`), with `biome` as `biome.json`. Sixteen: a role of fewer than 15 members is
/// in the suggestion tier, where the show policy does not show the layering family, so
/// the proposal would be held ("not shown") rather than offered.
fn layered(biome: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"demo\" }");
    let names: Vec<String> = (0..16).map(|i| format!("part{i}")).collect();
    for (i, n) in names.iter().enumerate() {
        let next = &names[(i + 1) % names.len()];
        write(
            r,
            &format!("core/{n}.ts"),
            &format!("import {{ {next} }} from \"./{next}\";\n\nexport function {n}() {{\n  return {next}();\n}}\n"),
        );
    }
    for n in ["home", "list", "detail"] {
        write(
            r,
            &format!("ui/{n}.ts"),
            &format!("import {{ part0 }} from \"../core/part0\";\n\nexport function {n}() {{\n  return part0();\n}}\n"),
        );
    }
    write(r, "biome.json", biome);
    dir
}

/// Pins the declared channel end to end: the restriction `biome.json` declares is
/// proposed at `init` (declared, proposed, advise, no agents choice) and nothing is
/// recorded in `drift.lock` for it; `census --from-map` lists it with its counts.
/// Before this stream the declaration was read only as a veto on mining.
#[test]
fn init_proposes_what_the_lint_configuration_declares() {
    let dir = layered(BIOME);
    let r = dir.path();
    let entries = from_map(r);
    let declared = of_kind(&entries, "declared");
    let proposed: Vec<&Value> = declared.iter().filter(|e| e["proposed"] == true).collect();
    assert_eq!(proposed.len(), 1, "{entries:#?}");
    let p = proposed[0];
    assert_eq!(p["convention"]["rule"]["signal"], "import:ui", "{p:#}");
    assert_eq!(p["follows"], 16, "{p:#}");
    assert_eq!(p["differ"], 0, "{p:#}");
    assert_eq!(p["unknown"], 0, "{p:#}");
    assert_eq!(p["declared"]["configs"][0], "biome.json", "{p:#}");
    let id = p["id"].as_str().unwrap().to_string();

    let out = drift(r, &["--no-cache", "init"]);
    assert!(out.contains(&format!("[{id}]")), "{out}");
    assert!(out.contains("declared in biome.json"), "{out}");
    let policy = ConventionsFile::load(r).unwrap().expect("a policy");
    let c = policy
        .conventions
        .iter()
        .find(|c| c.id == id)
        .unwrap_or_else(|| panic!("{id} not written: {:?}", policy.conventions));
    assert_eq!(c.from_map.as_deref(), Some("declared"));
    assert_eq!((c.status, c.mode), (Status::Proposed, Mode::Advise));
    assert_eq!(c.agents, None);
    let lock = std::fs::read_to_string(r.join("drift.lock")).unwrap_or_default();
    assert!(
        !lock.lines().any(|l| l.starts_with(&format!("{id} "))),
        "nothing is recorded until a person accepts it:\n{lock}"
    );
}

/// Pins that `drift review --accept <id>` of a declared rule records the files that
/// break it today in `drift.lock`, as the interactive accept does, so `drift check`
/// reports none of them as a new violation. Before, only the interactive accept
/// recorded them, and the non-interactive one reported today's breaks as new.
#[test]
fn accepting_a_declared_rule_records_its_breaks() {
    let dir = layered(BIOME);
    let r = dir.path();
    write(
        r,
        "core/bad.ts",
        "import { home } from \"../ui/home\";\n\nexport function bad() {\n  return home();\n}\n",
    );
    drift(r, &["--no-cache", "init"]);
    let policy = ConventionsFile::load(r).unwrap().expect("a policy");
    let id = policy
        .conventions
        .iter()
        .find(|c| c.from_map.as_deref() == Some("declared"))
        .unwrap_or_else(|| panic!("no declared proposal: {:?}", policy.conventions))
        .id
        .clone();
    let breaks = policy
        .conventions
        .iter()
        .find(|c| c.id == id)
        .map(|c| c.evidence.total - c.evidence.holders);
    assert_eq!(breaks, Some(1), "{:?}", policy.conventions);
    drift(r, &["--no-cache", "review", "--accept", &id]);
    let lock = std::fs::read_to_string(r.join("drift.lock")).unwrap_or_default();
    assert!(
        lock.lines().any(|l| l.starts_with(&format!("{id} core/bad.ts#"))),
        "the break existing at acceptance is recorded:\n{lock}"
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
    assert!(new.is_empty(), "{new:#?}");
}

/// Pins that a configuration Drift cannot read to the end gives nothing, never a guess:
/// the same `biome.json` cut off halfway proposes nothing and lists nothing.
#[test]
fn an_unreadable_configuration_yields_nothing() {
    let cut = &BIOME[..BIOME.find("\"level\"").unwrap()];
    let dir = layered(cut);
    let entries = from_map(dir.path());
    assert!(
        of_kind(&entries, "declared").is_empty(),
        "{entries:#?}"
    );
}

const SERVICES: &[&str] = &[
    "users", "billing", "orders", "invoices", "payments", "reports", "refunds", "coupons",
    "taxes", "ledgers", "shipments",
];

fn cap(s: &str) -> String {
    let mut c = s.chars();
    c.next().unwrap().to_uppercase().chain(c).collect()
}

/// A Nest app of eleven services, ten in `app.module.ts`'s providers (`shipments` is not),
/// and, with `unread`, a module beside it Drift cannot read (nested too deep to parse).
fn nest(unread: bool) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "app", "dependencies": { "@nestjs/common": "10" } }"#,
    );
    let mut imports = String::from("import { Module } from \"@nestjs/common\";\n");
    let mut providers = String::new();
    for n in SERVICES {
        write(
            r,
            &format!("src/{n}/{n}.service.ts"),
            &format!(
                "import {{ Injectable }} from \"@nestjs/common\";\n\n@Injectable()\nexport class {}Service {{\n  run() {{\n    return 1;\n  }}\n}}\n",
                cap(n)
            ),
        );
        if *n != "shipments" {
            imports.push_str(&format!(
                "import {{ {}Service }} from \"./{n}/{n}.service\";\n",
                cap(n)
            ));
            providers.push_str(&format!("    {}Service,\n", cap(n)));
        }
    }
    write(
        r,
        "src/app.module.ts",
        &format!(
            "{imports}\n@Module({{\n  providers: [\n{providers}  ],\n}})\nexport class AppModule {{}}\n"
        ),
    );
    if unread {
        write(
            r,
            "src/more.module.ts",
            &format!(
                "export const more = {}1{};\n",
                "(\n".repeat(5_000),
                "\n)".repeat(5_000)
            ),
        );
    }
    dir
}

fn wiring_note(r: &Path) -> Value {
    let entries = from_map(r);
    let notes = of_kind(&entries, "wiring");
    let found: Vec<&Value> = notes
        .iter()
        .filter(|n| n["note"] == "wiring")
        .collect();
    assert_eq!(found.len(), 1, "{entries:#?}");
    found[0].clone()
}

/// Pins the wiring channel: with the feature off, the regularity the miner computes is
/// listed as information (never proposed, never written, "cannot be checked yet"), with
/// the member left out named.
#[test]
fn a_wiring_regularity_is_listed_and_never_written() {
    let dir = nest(false);
    let r = dir.path();
    let n = wiring_note(r);
    assert_eq!(n["proposed"], false, "{n:#}");
    assert_eq!(n["checkable"], false, "{n:#}");
    assert!(n["id"].as_str().unwrap().starts_with("W-"), "{n:#}");
    let w = &n["wiring"];
    assert_eq!(w["members"], 11, "{w:#}");
    assert_eq!(w["registered"], 10, "{w:#}");
    assert_eq!(w["not_read"], 0, "{w:#}");
    assert_eq!(w["unknown"], 0, "{w:#}");
    assert_eq!(
        w["unregistered"][0],
        "src/shipments/shipments.service.ts#ShipmentsService",
        "{w:#}"
    );
    let text = drift(r, &["--no-cache", "census", "--from-map"]);
    assert!(text.contains("cannot be checked yet"), "{text}");
    drift(r, &["--no-cache", "init"]);
    let policy = ConventionsFile::load(r).unwrap().expect("a policy");
    assert!(
        policy.conventions.iter().all(|c| !c.rule.is_wiring()),
        "{:?}",
        policy.conventions
    );
}

/// Pins "unknown is never unregistered": one registration site Drift could not read is
/// counted as not read, and the member missing from the lists it did read is unknown.
#[test]
fn an_unread_registration_file_is_counted_as_not_read() {
    let dir = nest(true);
    let w = wiring_note(dir.path())["wiring"].clone();
    assert_eq!(w["not_read"], 1, "{w:#}");
    assert_eq!(w["not_read_files"][0], "src/more.module.ts", "{w:#}");
    assert_eq!(w["unknown"], 1, "{w:#}");
    assert_eq!(w["unregistered"], Value::Array(vec![]), "{w:#}");
}
