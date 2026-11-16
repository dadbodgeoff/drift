//! F2 (review R2 of S7 and S8): the lock's fingerprint lines and what they may baseline.
//!
//! - A fingerprint line is written as a comment, `#~ <id> <hex> <member>`, right below its
//!   member line; the form `<id> ~<hex> <member>` is still read.
//! - [`Lock::baseline_moved`] takes a violation for moved debt only one to one, with the
//!   same name, and only while the member line is in the lock.
//! - [`carry_moved_exceptions`] gives the reviewer's exception to exactly the violation
//!   the old member moved to.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use drift_core::{SymbolKind, WrapKind};
use drift_mine::check::{Extent, Violation};
use drift_mine::mine::{Candidate, Evidence, Rule};
use drift_mine::policy::{
    Convention, ConventionsFile, LOCK_FILE, Lock, carry_moved_exceptions,
};
use drift_mine::roles::{FileKinds, RoleSelector};
use drift_mine::tier::Tier;

const ID: &str = "D-aaaaaa";
const FP: &str = "0123456789abcdef";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn v(path: &str, symbol: &str) -> Violation {
    Violation {
        id: ID.into(),
        path: path.into(),
        symbol: symbol.into(),
        line: 1,
        summary: String::new(),
        evidence: "37/40".into(),
        example: String::new(),
        mode: "block".into(),
        tier: Tier::Default,
        baselined: false,
        suppressed: false,
        unsure: false,
        suppressed_neighbour: false,
        extent: Extent::Symbol { start: 1, end: 3 },
        wire: None,
        import: None,
        practice: None,
    }
}

/// A lock with `members`, each with the fingerprint line [`FP`].
fn lock_of(members: &[&str]) -> Lock {
    let mut lock = Lock::default();
    for m in members {
        lock.entries.insert((ID.into(), m.to_string()));
        lock.entries
            .insert((ID.into(), Lock::fingerprint_key(FP, m)));
    }
    lock
}

/// Every violation with the fingerprint [`FP`].
fn prints(vs: &[Violation]) -> BTreeMap<(String, String), String> {
    vs.iter()
        .map(|v| ((v.id.clone(), format!("{}#{}", v.path, v.symbol)), FP.to_string()))
        .collect()
}

fn present(keys: &[&str]) -> BTreeSet<String> {
    keys.iter().map(|k| k.to_string()).collect()
}

/// Pins: the lock writes `#~ <id> <hex> <member>` right below each member line (before:
/// `<id> ~<hex> <member>`, after every member line of the id), reads that and the
/// earlier form to the same entries, and an older Drift's reading (comments skipped)
/// sees each member once.
#[test]
fn fingerprint_lines_are_comments_below_their_member() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let lock = lock_of(&["app/a/route.ts#GET", "app/b/route.ts#GET"]);
    lock.save(r).unwrap();
    let text = std::fs::read_to_string(r.join(LOCK_FILE)).unwrap();
    let body: Vec<&str> = text.lines().skip(1).collect();
    assert_eq!(
        body,
        [
            "D-aaaaaa app/a/route.ts#GET",
            "#~ D-aaaaaa 0123456789abcdef app/a/route.ts#GET",
            "D-aaaaaa app/b/route.ts#GET",
            "#~ D-aaaaaa 0123456789abcdef app/b/route.ts#GET",
        ]
    );
    assert_eq!(Lock::load(r).unwrap(), lock);
    // An older Drift: `#` lines skipped, every other line an entry.
    let old: Vec<&str> = text
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.trim().starts_with('#'))
        .collect();
    assert_eq!(old.len(), 2);

    // The form first written is read the same.
    write(
        r,
        LOCK_FILE,
        "D-aaaaaa app/a/route.ts#GET\nD-aaaaaa app/b/route.ts#GET\n\
         D-aaaaaa ~0123456789abcdef app/a/route.ts#GET\n\
         D-aaaaaa ~0123456789abcdef app/b/route.ts#GET\n",
    );
    assert_eq!(Lock::load(r).unwrap(), lock);

    // A fingerprint line whose member line a person removed is not written back.
    let mut orphan = lock.clone();
    orphan
        .entries
        .remove(&(ID.to_string(), "app/b/route.ts#GET".to_string()));
    orphan.save(r).unwrap();
    let text = std::fs::read_to_string(r.join(LOCK_FILE)).unwrap();
    assert!(!text.contains("app/b/"), "{text}");
}

/// Pins: one gone member and one new violation that is the same unit (fingerprint and
/// name) is a move; it returns the old member for the new key.
#[test]
fn one_gone_and_one_new_with_the_same_name_is_a_move() {
    let lock = lock_of(&["app/a/route.ts#GET", "app/b/route.ts#GET"]);
    let mut vs = vec![v("app/moved/route.ts", "GET")];
    let fps = prints(&vs);
    let moved = lock.baseline_moved(&mut vs, &fps, &present(&["app/a/route.ts#GET"]));
    assert!(vs[0].baselined);
    assert_eq!(
        moved,
        BTreeMap::from([(
            (ID.to_string(), "app/moved/route.ts#GET".to_string()),
            "app/b/route.ts#GET".to_string()
        )])
    );
}

/// Pins: what is not one to one, or not the same name, or whose member line is gone, is
/// new (before: each gone line absorbed the first new violation with its fingerprint).
#[test]
fn what_cannot_be_told_to_have_moved_is_new() {
    let lock = lock_of(&["app/a/route.ts#GET", "app/b/route.ts#GET"]);
    // Two gone, one new.
    let mut vs = vec![v("app/new/route.ts", "GET")];
    let fps = prints(&vs);
    assert!(lock.baseline_moved(&mut vs, &fps, &present(&[])).is_empty());
    assert!(!vs[0].baselined);
    // One gone, two new.
    let mut vs = vec![v("app/c/route.ts", "GET"), v("app/d/route.ts", "GET")];
    let fps = prints(&vs);
    let still = present(&["app/a/route.ts#GET"]);
    assert!(lock.baseline_moved(&mut vs, &fps, &still).is_empty());
    assert!(vs.iter().all(|v| !v.baselined));
    // Another name: a rename is not followed.
    let mut vs = vec![v("app/c/route.ts", "POST")];
    let fps = prints(&vs);
    assert!(lock.baseline_moved(&mut vs, &fps, &still).is_empty());
    // A file unit keeps its file name when it moves.
    let files = lock_of(&["app/a/page.tsx#(file)"]);
    let mut vs = vec![v("app/x/layout.tsx", "(file)")];
    let fps = prints(&vs);
    assert!(files.baseline_moved(&mut vs, &fps, &present(&[])).is_empty());
    let mut vs = vec![v("app/x/page.tsx", "(file)")];
    let fps = prints(&vs);
    assert_eq!(files.baseline_moved(&mut vs, &fps, &present(&[])).len(), 1);
    // The member line removed by a person: its fingerprint line baselines nothing.
    let mut orphan = lock_of(&["app/a/route.ts#GET"]);
    orphan
        .entries
        .remove(&(ID.to_string(), "app/a/route.ts#GET".to_string()));
    let mut vs = vec![v("app/c/route.ts", "GET")];
    let fps = prints(&vs);
    assert!(orphan.baseline_moved(&mut vs, &fps, &present(&[])).is_empty());
    assert!(!vs[0].baselined);
}

fn convention() -> Convention {
    let cand = Candidate {
        id: ID.into(),
        role: RoleSelector {
            package: String::new(),
            dir: "app".into(),
            file: "route".into(),
            entry: "http".into(),
            kind: SymbolKind::Function,
            variety: None,
            export_name: None,
            member_kind: None,
            shape: None,
            also: vec![],
        },
        rule: Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of: vec!["lib/auth.ts#withAuth".into()],
        },
        evidence: Evidence {
            holders: 37,
            total: 40,
            lower_bound: 0.8,
            lift: 2.0,
            split: vec![],
            role_members: None,
            python_members: None,
        },
        score: 1.0,
        example: "app/a/route.ts#GET".into(),
        outliers: vec![],
        can_block: false,
        wiring: None,
        exempt: vec![],
        inherited: vec![],
        derived: vec![],
    };
    let mut c = ConventionsFile::merge(None, "e", FileKinds::default(), &[cand])
        .conventions
        .remove(0);
    c.set_exception("app/old/route.ts#GET", "public on purpose");
    c
}

/// Pins: the exception of the member that moved goes to the violation it moved to, not
/// to another one with the same fingerprint (before: the first violation with that
/// fingerprint and no exception, which could be one baselined by its own line).
#[test]
fn an_exception_follows_exactly_the_move() {
    let c = convention();
    let moved = BTreeMap::from([(
        (ID.to_string(), "app/new/route.ts#GET".to_string()),
        "app/old/route.ts#GET".to_string(),
    )]);
    let gained = carry_moved_exceptions(&[&c], &moved);
    assert_eq!(gained.len(), 1);
    assert_eq!(
        gained[0].exception("app/new/route.ts#GET").map(|e| e.reason.as_str()),
        Some("public on purpose")
    );
    assert_eq!(gained[0].exceptions.len(), 2);
    assert!(carry_moved_exceptions(&[&c], &BTreeMap::new()).is_empty());
}
