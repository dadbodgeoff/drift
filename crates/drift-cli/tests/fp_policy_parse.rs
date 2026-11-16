//! FP (hot paths): `ConventionsFile::load` parses the policy once where it parses, and
//! reads the version alone only when the full parse fails. Every answer is the one the
//! version-first order gave: a newer format is refused as newer whether or not the rest
//! parses, and a file of this format that does not parse says why.

use std::path::Path;

use drift_mine::policy::{ConventionsFile, NewerPolicy};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// A policy of format `version`; with `future_rule`, one convention of a rule type no
/// Drift knows (so the full parse fails), as in `s18_upgrade.rs`.
fn policy(version: u32, future_rule: bool) -> String {
    let conventions = if future_rule {
        "conventions:
- id: D-f00000
  status: accepted
  mode: block
  summary: a rule of a later Drift
  role:
    package: ''
    dir: app/api
    file: route
    entry: http
    kind: function
  rule:
    type: a_rule_of_the_future
  evidence:
    holders: 20
    total: 20
    lower_bound: 0.84
    lift: 1.0
  example: app/api/a/route.ts#GET
  selector_version: 3
"
    } else {
        "conventions: []\n"
    };
    format!(
        "version: {version}\nengine: drift 9.0.0\nfile_kinds:\n  literal_stems:\n  - route\n  suffixes: []\n{conventions}"
    )
}

fn load(text: &str) -> anyhow::Result<Option<ConventionsFile>> {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), ".drift/conventions.yaml", text);
    ConventionsFile::load(dir.path())
}

/// Pins: a newer format is `NewerPolicy` with its version, both when the whole file
/// parses (now caught by the check after the one parse) and when it does not (caught by
/// the version read alone, as before).
#[test]
fn a_newer_format_is_refused_as_newer_whether_or_not_it_parses() {
    for future_rule in [false, true] {
        let err = load(&policy(99, future_rule)).expect_err("a newer format is refused");
        let newer = err
            .downcast_ref::<NewerPolicy>()
            .unwrap_or_else(|| panic!("{future_rule}: {err:#}"));
        assert_eq!(newer.version, 99, "{future_rule}");
        assert!(newer.path.ends_with("conventions.yaml"), "{}", newer.path);
    }
}

/// Pins: a file of this format that parses loads; one that does not parse says it could
/// not be parsed (not that it is newer).
#[test]
fn a_current_file_loads_and_a_broken_one_says_parsing() {
    let f = load(&policy(1, false)).unwrap().expect("a policy");
    assert_eq!(f.version, 1);
    assert!(f.conventions.is_empty());
    let err = load(&policy(1, true)).expect_err("an unknown rule type does not parse");
    assert!(err.downcast_ref::<NewerPolicy>().is_none(), "{err:#}");
    assert!(err.to_string().starts_with("parsing "), "{err:#}");
}
