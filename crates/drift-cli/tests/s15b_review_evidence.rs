//! S15b, item 3: `drift review` records what the person saw at the moment they accept
//! (`Convention.accepted_evidence`), not only at the next `drift init` after it.

use std::path::Path;
use std::process::{Command, Stdio};

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn run(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .env_remove("CLAUDE_CODE_SESSION_ID")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .unwrap();
    format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
}

/// A hand-written proposal (kept in the file by `agents: show`), with evidence no run
/// of the miner on this repository would give, so the record can only be the file's.
const PROPOSAL: &str = "- id: D-15b100
  status: proposed
  mode: advise
  summary: 'files in ** use lib1 for g1'
  role:
    package: ''
    dir: '**'
    file: '*'
    entry: '-'
    kind: module
  rule:
    type: prefers_library
    group: g1
    preferred: 'lib1'
  evidence:
    holders: 23
    total: 29
    lower_bound: 0.61
    lift: 1.0
  example: src/a.ts#(file)
  selector_version: 3
  agents: show
";

/// Pins that `drift review --accept` writes the evidence it accepted on: before S15b the
/// file had no `accepted_evidence` until a later `drift init` met the convention, by
/// which time the evidence could have been refreshed.
#[test]
fn review_accept_records_the_evidence_the_person_saw() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(r, "src/a.ts", "export function a() {\n  return 1;\n}\n");
    run(r, &["init"]);
    let p = r.join(".drift/conventions.yaml");
    let yaml = std::fs::read_to_string(&p).unwrap();
    let yaml = if yaml.contains("conventions: []") {
        yaml.replacen("conventions: []", &format!("conventions:\n{PROPOSAL}"), 1)
    } else {
        yaml.replacen("conventions:\n", &format!("conventions:\n{PROPOSAL}"), 1)
    };
    std::fs::write(&p, &yaml).unwrap();
    assert!(!yaml.contains("accepted_evidence"), "{yaml}");
    let out = run(r, &["review", "--accept", "D-15b100"]);
    let yaml = std::fs::read_to_string(&p).unwrap();
    let at = yaml
        .find("accepted_evidence:")
        .unwrap_or_else(|| panic!("{out}\n{yaml}"));
    let rest = &yaml[at..];
    assert!(rest.contains("role_size: 29"), "{yaml}");
    assert!(rest.contains("holders: 23"), "{yaml}");
    assert!(rest.contains("lower_bound: 0.61"), "{yaml}");
}
