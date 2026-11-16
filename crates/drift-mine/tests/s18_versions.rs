//! Upgrades in both directions (stream S18): the files Drift writes stay readable by
//! the Drift that wrote them before, and a form an older Drift would misread makes it
//! refuse the file instead of checking a different rule.
//!
//! - `.drift/conventions.yaml`: a version-1 file with no new form loads and is written
//!   back byte for byte as the save before this change wrote it; a promoted practice
//!   that accepts a mechanism whole or any enforcing way is written as version 3, and
//!   the fields an older Drift may skip (`from_map`, `accepted_evidence`) do not raise
//!   it; a file of a future version is refused with what to do, even when it holds a
//!   rule type this Drift cannot parse.
//! - `drift.lock`: a lock written before fingerprint lines, and one with them, load.
//! - `.drift/security.lock`: a baseline written before the `# inventory:` stamp keeps
//!   failing on what a change adds, and a kind added since fails nothing.
//!
//! All fixtures are text, as the older Drift wrote them.

use std::collections::BTreeSet;
use std::path::Path;

use drift_mine::mine::Rule;
use drift_mine::policy::{
    AcceptedEvidence, CONVENTIONS_FILE, ConventionsFile, LOCK_FILE, Lock, NewerPolicy,
    POLICY_VERSION, POLICY_VERSION_FORMS, POLICY_VERSION_PACKAGES, POLICY_VERSION_SINGLE,
    written_version,
};
use drift_mine::ratchet::{Findings, compare_with, parse_baseline};

/// The header `ConventionsFile::save` writes above the YAML.
const HEADER: &str = "# Drift conventions: mined from this codebase, approved by people.\n\
                      # status: proposed | accepted | rejected    mode: advise | block\n\
                      # Edit status/mode by hand or with `drift review`. Agents must not edit this file.\n";

/// A version-1 policy as a Drift from before this build wrote it: one promoted
/// practice accepted by its ways (`any_of` alone), the form every such Drift reads.
const V1_PRACTICE: &str = "version: 1
engine: drift 0.1.0-dev
file_kinds:
  literal_stems:
  - route
  suffixes: []
conventions:
- id: D-5a1e00
  status: accepted
  mode: advise
  summary: 'Sign-in in app/api: wrapped in withAuth'
  role:
    package: ''
    dir: app/api
    file: (practice)
    entry: '-'
    kind: module
  rule:
    type: practice
    concern: authn
    any_of:
    - wrap:lib/auth.ts#withAuth
  evidence:
    holders: 38
    total: 40
    lower_bound: 0.83
    lift: 1.0
  example: app/api/r10/route.ts#GET
  selector_version: 3
  agents: show
  promoted_from_practice: P-5a1e00
";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn load(root: &Path) -> ConventionsFile {
    ConventionsFile::load(root).unwrap().expect("a policy")
}

fn saved(root: &Path, f: &ConventionsFile) -> String {
    f.save(root).unwrap();
    std::fs::read_to_string(root.join(CONVENTIONS_FILE)).unwrap()
}

/// `V1_PRACTICE` with `extra` lines added to its rule (indented as rule fields).
fn with_rule_lines(extra: &str) -> String {
    let at = "    - wrap:lib/auth.ts#withAuth\n";
    let out = V1_PRACTICE.replace(at, &format!("{at}{extra}"));
    assert_ne!(out, V1_PRACTICE, "the fixture has the anchor line");
    out
}

/// Pins: a file with none of the new forms is written as version 1 and byte for byte
/// as the save before this change wrote it (the header and the YAML of the file as
/// loaded), and reading it back and writing it again changes nothing. Fails if the
/// raised version leaks into a file without the forms.
#[test]
fn a_version_1_file_loads_and_round_trips_byte_for_byte() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, CONVENTIONS_FILE, V1_PRACTICE);
    let f = load(r);
    assert_eq!(f.version, 1);
    assert_eq!(written_version(&f), POLICY_VERSION_SINGLE);
    let first = saved(r, &f);
    // What the save before this change wrote for a version-1 file: nothing else.
    let before = format!("{HEADER}{}", serde_saphyr::to_string(&f).unwrap());
    assert_eq!(first, before);
    assert!(first.contains("\nversion: 1\n"), "{first}");
    assert!(!first.contains("any_mechanism"), "{first}");
    assert!(!first.contains("any_enforcing"), "{first}");
    let back = load(r);
    assert_eq!(back, f);
    assert_eq!(saved(r, &back), first);
}

/// Pins (F10, review R10 F-8): a practice of one file or one route prefix is written
/// as version 3, so an older Drift refuses it instead of checking it over its whole
/// directory. Nothing pinned it before.
#[test]
fn a_file_or_route_practice_raises_the_version() {
    for extra in [
        "    in_file: app/api/a/route.ts\n",
        "    under_route: /api/a\n",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, CONVENTIONS_FILE, &with_rule_lines(extra));
        let f = load(r);
        assert_eq!(written_version(&f), POLICY_VERSION_FORMS, "{extra}");
        assert!(saved(r, &f).contains("\nversion: 3\n"), "{extra}");
    }
}

/// Pins: a practice that accepts a mechanism whole is written as version 3, which a
/// Drift that reads up to 2 refuses ("written by a newer Drift") instead of checking
/// `any_of` alone and reporting every unit that uses another instrument of the
/// mechanism. Before this change the file was written as version 1.
#[test]
fn a_mechanism_wide_practice_is_written_with_the_raised_version() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        CONVENTIONS_FILE,
        &with_rule_lines("    any_mechanism:\n    - permission\n"),
    );
    let f = load(r);
    assert!(matches!(
        &f.conventions[0].rule,
        Rule::Practice { any_mechanism, .. } if any_mechanism == &["permission".to_string()]
    ));
    assert_eq!(written_version(&f), POLICY_VERSION_FORMS);
    let text = saved(r, &f);
    assert!(text.contains("\nversion: 3\n"), "{text}");
    assert!(text.contains("any_mechanism:"), "{text}");
    // This Drift reads what it wrote.
    assert_eq!(load(r).conventions, f.conventions);
    assert!(POLICY_VERSION_FORMS <= POLICY_VERSION);
}

/// Pins: "any way that enforces" raises the version the same way.
#[test]
fn an_any_enforcing_practice_is_written_with_the_raised_version() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        CONVENTIONS_FILE,
        &with_rule_lines("    any_enforcing: true\n"),
    );
    let f = load(r);
    assert_eq!(written_version(&f), POLICY_VERSION_FORMS);
    assert!(saved(r, &f).contains("\nversion: 3\n"));
}

/// Pins: the raised version is decided from the content on each write. A workspace
/// policy without the forms stays version 2 (as before); with one, 3; removing the
/// last form writes the old version again.
#[test]
fn the_version_follows_the_content_with_or_without_packages() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, CONVENTIONS_FILE, V1_PRACTICE);
    let mut f = load(r);
    f.packages = vec![String::new(), "web".to_string()];
    assert_eq!(written_version(&f), POLICY_VERSION_PACKAGES);
    if let Rule::Practice { any_mechanism, .. } = &mut f.conventions[0].rule {
        any_mechanism.push("permission".to_string());
    }
    assert_eq!(written_version(&f), POLICY_VERSION_FORMS);
    if let Rule::Practice { any_mechanism, .. } = &mut f.conventions[0].rule {
        any_mechanism.clear();
    }
    f.packages.clear();
    f.version = POLICY_VERSION_FORMS;
    assert_eq!(written_version(&f), POLICY_VERSION_SINGLE);
}

/// Pins: the fields an older Drift can skip without checking anything differently do
/// not raise the version (see `misread_before_forms` for why each is safe), so a
/// policy that gains them is still read by the Drift a teammate has.
#[test]
fn fields_an_older_drift_may_skip_keep_the_version() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, CONVENTIONS_FILE, V1_PRACTICE);
    let mut f = load(r);
    let c = &mut f.conventions[0];
    c.from_map = Some("practice".to_string());
    c.accepted_evidence = Some(AcceptedEvidence::of(&c.evidence));
    assert_eq!(written_version(&f), POLICY_VERSION_SINGLE);
    let text = saved(r, &f);
    assert!(text.contains("\nversion: 1\n"), "{text}");
    assert!(text.contains("from_map: practice"), "{text}");
}

/// Pins: a file of a version above this Drift's is refused with what to do (upgrade;
/// `drift --version` shows the installed one), and so is one that also holds a rule
/// type this Drift does not know: the version is read first, so the person is told to
/// upgrade instead of being shown a parse error. Before this change the second file
/// failed with "unknown variant".
#[test]
fn a_future_version_is_refused_with_what_to_do() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let future = POLICY_VERSION + 1;
    let text = V1_PRACTICE
        .replace("version: 1\n", &format!("version: {future}\n"))
        .replace("type: practice", "type: a_rule_of_the_future");
    write(r, CONVENTIONS_FILE, &text);
    let e = ConventionsFile::load(r).expect_err("refused");
    let newer = e
        .downcast_ref::<NewerPolicy>()
        .expect("a NewerPolicy error");
    assert_eq!(newer.version, future);
    let msg = format!("{e:#}");
    assert!(msg.contains("was written by a newer Drift"), "{msg}");
    assert!(msg.contains("Upgrade Drift"), "{msg}");
    assert!(msg.contains("drift --version"), "{msg}");
    assert!(!msg.contains("unknown variant"), "{msg}");
    // What a hook or an MCP tool says: whole within the hook's 200 characters, no path.
    let agents = newer.for_agents();
    assert!(agents.chars().count() < 200, "{agents}");
    assert!(agents.contains("drift --version"), "{agents}");
    assert!(!agents.contains(&r.display().to_string()), "{agents}");

    // A future version this Drift could parse is refused all the same.
    write(
        r,
        CONVENTIONS_FILE,
        &V1_PRACTICE.replace("version: 1\n", &format!("version: {future}\n")),
    );
    let e = ConventionsFile::load(r).expect_err("refused");
    assert!(e.downcast_ref::<NewerPolicy>().is_some(), "{e:#}");
}

/// Pins: a lock written before fingerprint lines loads as it always did (every line a
/// member, none moved) and is written back byte for byte; one with a fingerprint line
/// counts the member once.
#[test]
fn an_old_lock_and_a_fingerprinted_one_load() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let old = "# drift.lock: legacy violations that never block. Fix code to remove lines.\n\
               D-aaaaaa app/api/a/route.ts#GET\n\
               D-aaaaaa app/api/b/route.ts#POST\n";
    write(r, LOCK_FILE, old);
    let lock = Lock::load(r).unwrap();
    assert!(lock.contains("D-aaaaaa", "app/api/a/route.ts#GET"));
    assert_eq!(lock.members(), 2);
    assert!(!lock.has_fingerprints());
    lock.save(r).unwrap();
    assert_eq!(std::fs::read_to_string(r.join(LOCK_FILE)).unwrap(), old);

    // The form this build writes (F10, review R10 F-11: the `<id> ~<hex>` form was
    // never released).
    let new = format!("{old}#~ D-aaaaaa 0123456789abcdef app/api/a/route.ts#GET\n");
    write(r, LOCK_FILE, &new);
    let lock = Lock::load(r).unwrap();
    assert_eq!(
        lock.members(),
        2,
        "a fingerprint line is no second violation"
    );
    assert!(lock.has_fingerprints());
    assert!(lock.contains("D-aaaaaa", "app/api/a/route.ts#GET"));
}

/// The header of a security baseline written before the stamp (no `# inventory:`, no
/// `# fail:` line), as the older Drift's `render_lock` wrote it.
const OLD_BASELINE: &str = "# drift security baseline: what `drift security` found when this was written.\n\
                            # `drift security --ratchet` reports what is found now and is not here.\n\
                            # Written by `drift security --write-baseline`; do not edit by hand.\n\
                            no-guard\tapp/api/a/route.ts#GET GET /api/a\n\
                            risky\traw_sql in lib/db.ts#query\n";

fn found(rows: &[(&str, &str)]) -> Findings {
    rows.iter()
        .map(|(k, key)| {
            (
                (k.to_string(), key.to_string()),
                "app/api/x/route.ts:1".to_string(),
            )
        })
        .collect()
}

/// Pins: a baseline from before the stamp reads as inventory 1 with every kind of
/// then failing; what it holds is kept; a kind added since (`unscoped-key`) is new in
/// this Drift and fails nothing; so is a finding of an old kind whose reading was
/// widened since (`no-guard`: F3, review R3, the upgrade must not fail CI); a finding
/// of an old kind read as before (`workflow`) that a change added still fails.
#[test]
fn an_old_security_baseline_keeps_working() {
    let b = parse_baseline(OLD_BASELINE);
    assert_eq!(b.version, 1);
    assert_eq!(b.fail, None);
    assert_eq!(
        b.findings,
        BTreeSet::from([
            (
                "no-guard".to_string(),
                "app/api/a/route.ts#GET GET /api/a".to_string()
            ),
            (
                "risky".to_string(),
                "raw_sql in lib/db.ts#query".to_string()
            ),
        ])
    );
    let now = found(&[
        ("no-guard", "app/api/a/route.ts#GET GET /api/a"),
        ("risky", "raw_sql in lib/db.ts#query"),
        (
            "unscoped-key",
            "app/api/c/route.ts#GET GET /api/c takes orgId",
        ),
        ("no-guard", "app/api/d/route.ts#GET GET /api/d"),
        (
            "workflow",
            "unpinned_action in .github/workflows/ci.yml job deploy: someone/deploy@v2",
        ),
    ]);
    let r = compare_with(&now, &b, None);
    assert_eq!(r.kept, 2);
    assert!(r.new_in_drift.contains_key("unscoped-key"), "{r:?}");
    assert!(!r.added.contains_key("unscoped-key"), "{r:?}");
    assert!(!r.advised.contains_key("unscoped-key"), "{r:?}");
    assert_eq!(
        r.new_in_drift.get("no-guard").map(Vec::len),
        Some(1),
        "a wider reading's unguarded route fails nothing: {r:?}"
    );
    assert!(!r.added.contains_key("no-guard"), "{r:?}");
    assert_eq!(
        r.added.get("workflow").map(Vec::len),
        Some(1),
        "a change's finding of a kind read as before still fails: {r:?}"
    );
    assert!(r.gone.is_empty());

    // A stamped baseline (inventory 2) holds what that inventory finds: the kind is no
    // longer new in Drift, and it advises until a person sets it to fail.
    let stamped = OLD_BASELINE.replace(
        "do not edit by hand.\n",
        "do not edit by hand.\n# inventory: 2\n# fail: no-guard,risky\n",
    );
    let b = parse_baseline(&stamped);
    assert_eq!(b.version, 2);
    let r = compare_with(&now, &b, None);
    assert!(r.new_in_drift.is_empty(), "{r:?}");
    assert!(r.advised.contains_key("unscoped-key"), "{r:?}");
}
