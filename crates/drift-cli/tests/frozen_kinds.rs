//! `drift init` on an existing conventions file mines over the file kinds frozen in
//! it, so a convention is never enforced over files its evidence did not count;
//! `drift init --refresh-kinds` adopts newly learned kinds (Python layers) on request.

use std::path::Path;
use std::process::{Command, Output};

use drift_mine::policy::ConventionsFile;

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

fn drift(root: &Path, args: &[&str]) -> Output {
    Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap()
}

fn ok(root: &Path, args: &[&str]) -> Output {
    let out = drift(root, args);
    assert!(
        out.status.success(),
        "{args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    out
}

/// 30 apps: `proj/appN/filtersets.py` holds a filter set decorated with
/// `@register_filterset` (app0's is not), `proj/appN/forms/filtersets.py` an
/// undecorated filter form.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "proj/__init__.py", "");
    write(
        r,
        "proj/registry.py",
        "def register_filterset(cls):\n    return cls\n",
    );
    for i in 0..30 {
        let deco = if i == 0 { "" } else { "@register_filterset\n" };
        write(r, &format!("proj/app{i}/__init__.py"), "");
        write(
            r,
            &format!("proj/app{i}/filtersets.py"),
            &format!(
                "from proj.registry import register_filterset\n\n\n{deco}class App{i}FilterSet:\n    pass\n"
            ),
        );
        write(r, &format!("proj/app{i}/forms/__init__.py"), "");
        write(
            r,
            &format!("proj/app{i}/forms/filtersets.py"),
            &format!("class App{i}FilterForm:\n    pass\n"),
        );
    }
    dir
}

/// Accept every convention that requires `register_filterset` and set it to block. Python
/// conventions are suggestions (decision D7: Python advises only), so blocking takes `--force`.
fn block_register_rules(r: &Path) -> Vec<String> {
    // Read from the file as written: this process applies the show policy when it loads
    // the policy (`drift_mine::show`), and the proposals here are of a family it hides.
    let text = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let mut ids: Vec<String> = Vec::new();
    let mut id = String::new();
    for line in text.lines() {
        if let Some(rest) = line.trim_start().strip_prefix("- id: ") {
            id = rest.trim().to_string();
        } else if line.contains("register_filterset") && !ids.contains(&id) {
            ids.push(id.clone());
        }
    }
    if !ids.is_empty() {
        ok(r, &["review", "--block", &ids.join(","), "--force"]);
    }
    ids
}

#[test]
fn reinit_mines_over_the_frozen_file_kinds() {
    let dir = repo();
    let r = dir.path();
    // A conventions file written before layered file kinds existed.
    write(
        r,
        ".drift/conventions.yaml",
        "version: 1\nengine: drift 0.1.0-dev\nfile_kinds:\n  literal_stems:\n  - __init__\n  - filtersets\n  suffixes: []\nconventions: []\n",
    );
    ok(r, &["init"]);
    let p = ConventionsFile::load(r).unwrap().unwrap();
    assert!(
        p.file_kinds.layers.is_empty(),
        "the frozen vocabulary is kept"
    );
    // Mined over the frozen vocabulary, "(filtersets files)" holds the forms too: no
    // convention at 29 of 60. Whatever is proposed, its evidence covers what `check`
    // enforces, so a new filter form breaks nothing.
    block_register_rules(r);
    write(
        r,
        "proj/app30/forms/filtersets.py",
        "class App30FilterForm:\n    pass\n",
    );
    let out = drift(r, &["check"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "{stdout}");
    assert!(!stdout.contains("App30FilterForm"), "{stdout}");

    // Adopting the new kinds is explicit, and warns.
    let out = ok(r, &["init", "--refresh-kinds"]);
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("file kinds relearned"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let p = ConventionsFile::load(r).unwrap().unwrap();
    assert!(p.file_kinds.layers.contains("forms/filtersets"));
    let ids = block_register_rules(r);
    assert!(!ids.is_empty(), "filter sets are decorated, 29 of 30");
    let p = ConventionsFile::load(r).unwrap().unwrap();
    for c in p.conventions.iter().filter(|c| ids.contains(&c.id)) {
        assert_eq!(c.evidence.total, 30, "{}", c.summary);
    }
    // The forms are not members: a new one is no violation, a new filter set is.
    write(
        r,
        "proj/app31/filtersets.py",
        "class App31FilterSet:\n    pass\n",
    );
    let out = drift(r, &["check"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(!stdout.contains("App30FilterForm"), "{stdout}");
    assert!(stdout.contains("App31FilterSet"), "{stdout}");
}
