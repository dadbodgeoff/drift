//! S15b, item 2: under a cap, what blocks comes first, and the line that says how many
//! more there are says how many of them block and how many advise, in the words of the
//! agent message and the GitHub summary (`drift_mine::report::cut_note`).

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
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// One hand-written, accepted library preference (a role of 30, so `block` blocks).
fn convention(i: usize, mode: &str) -> String {
    format!(
        "- id: D-15b0{i:02}
  status: accepted
  mode: {mode}
  summary: 'files in ** use lib{i} for g{i}'
  role:
    package: ''
    dir: '**'
    file: '*'
    entry: '-'
    kind: module
  rule:
    type: prefers_library
    group: g{i}
    preferred: 'lib{i}'
  evidence:
    holders: 27
    total: 30
    lower_bound: 0.75
    lift: 1.0
  example: src/a.ts#(file)
  selector_version: 3
  agents: show
"
    )
}

/// Pins the export's cut line: 12 accepted rules (11 that block, 1 that advises) with a
/// cap of 10 leave out 2, one that blocks and one that advises, and the line says so.
/// Before S15b it read `- …and 2 more: run ...`, saying nothing of what was cut.
#[test]
fn the_export_cut_line_says_how_many_block_and_how_many_advise() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(r, "src/a.ts", "export function a() {\n  return 1;\n}\n");
    run(r, &["init"]);
    let p = r.join(".drift/conventions.yaml");
    let yaml = std::fs::read_to_string(&p).unwrap();
    let extra: String = (0..12)
        .map(|i| convention(i, if i < 11 { "block" } else { "advise" }))
        .collect();
    let yaml = if yaml.contains("conventions: []") {
        yaml.replacen("conventions: []", &format!("conventions:\n{extra}"), 1)
    } else {
        yaml.replacen("conventions:\n", &format!("conventions:\n{extra}"), 1)
    };
    std::fs::write(&p, yaml).unwrap();
    let md = run(r, &["export", "agents-md"]);
    assert!(
        md.contains("- …and 2 more (1 that block, 1 advice): run `drift check` before finishing."),
        "{md}"
    );
    // What blocks comes first: all ten shown rules block, the advising one is cut.
    assert_eq!(
        md.matches(" follow it, blocks). Example: `").count(),
        10,
        "{md}"
    );
    assert!(!md.contains("lib11 for g11"), "{md}");
}
