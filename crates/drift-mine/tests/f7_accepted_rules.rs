//! Mining is frozen (fix F7): a convention proposed from a map and then accepted is not
//! fed to mining's hysteresis ([`ConventionsFile::accepted_rules`], which `drift init`,
//! `drift review` and `drift card` pass to `mine_keeping`). A from-map layering
//! convention's id is mining's id for its role and rule, so before this fix accepting
//! one kept a mined draft of the same role and rule where the caps drop it, and what
//! was mined changed with a decision about something mining never proposed.

use std::path::Path;

use drift_mine::mine::Rule;
use drift_mine::policy::{CONVENTIONS_FILE, ConventionsFile};

/// Two accepted layering conventions of one rule: one mined, one from the map.
const POLICY: &str = "version: 1
engine: drift 0.1.0-dev
file_kinds:
  literal_stems: []
  suffixes: []
conventions:
- id: D-aaaaaa
  status: accepted
  mode: advise
  summary: 'Files in lib never import app'
  role:
    package: ''
    dir: lib
    file: '*'
    entry: '-'
    kind: module
  rule:
    type: avoids
    signal: import:app
  evidence:
    holders: 20
    total: 20
    lower_bound: 0.83
    lift: 1.0
  example: lib/a.ts#a
- id: D-bbbbbb
  status: accepted
  mode: advise
  summary: 'Files in core never import ui'
  role:
    package: ''
    dir: core
    file: '*'
    entry: '-'
    kind: module
  rule:
    type: avoids
    signal: import:ui
  evidence:
    holders: 12
    total: 12
    lower_bound: 0.75
    lift: 1.0
  example: core/a.ts#a
  from_map: layering
";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// Pins: only the mined accepted convention is kept by hysteresis; the accepted
/// from-map one is not. Fails before the fix (both were returned).
#[test]
fn an_accepted_from_map_convention_is_not_kept_by_mining() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, CONVENTIONS_FILE, POLICY);
    let f = ConventionsFile::load(r).unwrap().expect("a policy");
    assert_eq!(f.conventions.len(), 2, "both conventions load");
    let kept = f.accepted_rules();
    assert_eq!(kept.len(), 1, "{kept:?}");
    assert!(
        matches!(&kept[0].1, Rule::Avoids { signal } if signal == "import:app"),
        "{kept:?}"
    );
}
